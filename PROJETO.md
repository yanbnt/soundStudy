# soundStudy

App que transforma uma mÃºsica (MP3, WAV, M4Aâ€¦) em **partitura, cifras e letra sincronizadas com o Ã¡udio**, para quem estÃ¡ aprendendo a ler e tocar. Roda no computador do usuÃ¡rio (Windows), sem internet depois de instalado.

Plano de negÃ³cio (Claude Docs): https://claude.ai/code/artifact/d81bf2c1-bd90-4429-a404-7c07d69bf033

## VisÃ£o do produto

- Hoje: ferramenta local de transcriÃ§Ã£o e estudo (partitura + cifras + letra + jogo).
- Futuro: **rede social educativa de mÃºsicos**. Cada mÃºsica tem a partitura automÃ¡tica e vÃ­deos de mÃºsicos tocando; a comunidade vota e o mais votado vira o **vÃ­deo padrÃ£o** daquela mÃºsica (por instrumento e nÃ­vel).
- PÃºblico: louvor, pagode e sertanejo, do iniciante ao profissional. LanÃ§amento com **louvor e pagode**.
- ComeÃ§o com cerca de **R$ 100**, app primeiro (o site da rede vem depois).
- **Premium**: transcriÃ§Ãµes ilimitadas, nÃ­vel detalhado, Modo Show valendo pontos (microfone), entre outros. Nesta versÃ£o de teste o Premium estÃ¡ liberado (`PREMIUM_LIBERADO` em `web/app.js`).

## Como rodar

- Pasta: `C:\Users\Make\Documents\soundStudy` (pasta de desenvolvimento, ainda com o nome antigo)
- UsuÃ¡rio final: dois cliques em `iniciar.bat` (na primeira vez cria o `.venv` e instala o `requirements.txt`; abre `http://127.0.0.1:8765`). Se o servidor jÃ¡ estiver no ar, sÃ³ abre o navegador.
- Desenvolvimento:
  - `.venv\Scripts\python.exe -m uvicorn app.server:app --host 127.0.0.1 --port 8765`
  - **Reinicie o servidor depois de mudar qualquer arquivo Python** (o frontend Ã© servido direto do disco: basta recarregar a pÃ¡gina).
- Python 3.12 (venv em `.venv`). Torch 2.5.1 CPU, Demucs, librosa 1.0, music21, FastAPI, faster-whisper.
- Na primeira transcriÃ§Ã£o o app baixa modelos: Demucs htdemucs (~80 MB) e Whisper small (~480 MB).

## Arquitetura

### Backend (`app/`)

| Arquivo | O que faz |
| --- | --- |
| `server.py` | FastAPI: `/api/songs` (listar, enviar, ver, renomear, excluir, reprocessar), `/api/songs/{id}/lyrics` (GET texto atual, PUT letra colada; vazio desfaz), `/lyrics/search` (versÃµes na base de letras) e `/lyrics/use` (usa a versÃ£o escolhida), `/api/stages`, arquivos em `/files` e frontend em `/static` |
| `pipeline.py` | Fila com um worker. Etapas: `convert` â†’ `separate` (Demucs **htdemucs_6s**: voz, violÃ£o, teclado, outros, baixo, percussÃ£o) â†’ `rhythm` â†’ `harmony` â†’ `melody` â†’ `violao` â†’ `lyrics` â†’ `score`. Grava `meta.json` e `analysis.json`. MÃºsicas antigas (4 partes) sÃ£o separadas de novo ao reprocessar. `save_lyrics`, `use_api_lyrics` e `rebuild_scores` refazem as partituras em segundos |
| `analysis.py` | Pulso (librosa + correÃ§Ã£o de contratempo pelo bumbo/baixo), levada binÃ¡ria ou ternÃ¡ria (4/4 ou 12/8), tom (perfil de Krumhansl e depois **confirmado pelos acordes**: `key_from_chords`), acordes (modelo BTC; reserva por croma), melodia (pYIN â†’ eventos de nota â†’ grade). `spell_with_bass` (baixo nota a nota) existe mas **nÃ£o estÃ¡ ligado**: piorou a prova |
| `lvcr/` | **Modelo de acordes em uso**: Jiang et al., "Large-Vocabulary Chord Transcription via Chord Structure Decomposition" (ISMIR 2019, MIT). DecompÃµe o acorde em trÃ­ade + baixo + 7Âª + 9Âª + 11Âª + 13Âª; vocabulÃ¡rio com inversÃµes e baixo pedal (m/b7, maj/2, maj/3, maj/5â€¦), 7M(9), m7(9), 7(9), 7(11), 7(13), 7(4). 5 redes (5,5 MB cada) votam; ~35 s por mÃºsica no PC do usuÃ¡rio. Pesos carregados com `weights_only=True` |
| `chord_model.py` + `app/btc/` | BTC (Park et al., ISMIR 2019, licenÃ§a MIT): 170 acordes. Reserva se `lvcr/` faltar. Ajustes locais: `yaml.safe_load` e `np.float` â†’ `float` |
| `hardware.py` | **Modo de qualidade** (`data/config.json`: auto, rÃ¡pida, mÃ¡xima). Detecta placa NVIDIA (CUDA) e decide: separaÃ§Ã£o mÃ¡xima, Whisper `large-v3` na placa e animaÃ§Ãµes em resoluÃ§Ã£o cheia a 60 quadros; sem placa: rÃ¡pida, `small`, animaÃ§Ãµes leves. `/api/config` (GET/PUT) e engrenagem no topo da tela |
| `separation.py` | Dois motores, mesmas 6 partes. **RÃ¡pida**: Demucs htdemucs_6s (MIT); confunde violÃ£o de nylon com piano Ã s vezes (intro, finais). **MÃ¡xima**: BS-RoFormer SW (pacote `bs-roformer-infer`, cÃ³digo MIT, pesos de 667 MB em `data/models/`, **licenÃ§a dos pesos desconhecida**: sÃ³ teste/uso pessoal atÃ© resolver). Na placa de vÃ­deo leva minutos; no PC sem placa, horas. "Refazer com separaÃ§Ã£o mÃ¡xima" no menu da mÃºsica |
| `basicpitch/` | Basic Pitch (Spotify, Apache 2.0), sÃ³ o modelo ONNX de 230 KB e a decodificaÃ§Ã£o de notas adaptada (sem TensorFlow). ~5 s por parte da mÃºsica no PC do usuÃ¡rio |
| `violao.py` | ViolÃ£o nota por nota: Basic Pitch na parte "guitar" â†’ ataques (notas juntas atÃ© 45 ms viram acorde) â†’ corda e casa por Viterbi (forma confortÃ¡vel, mÃ£o andando pouco) â†’ MusicXML com pauta (clave de sol com 8) + **tablatura** de 6 cordas e cifras em cima (`score_violao.musicxml`) |
| `lyrics.py` | Letra: faster-whisper (`PAUTA_WHISPER_MODEL`, padrÃ£o `small`) na voz separada; `align_text` encaixa letra colada; `align_synced` encaixa letra com tempo por linha (LRC) achando o atraso e espalhando as sÃ­labas pelas notas cantadas; `words_on_notes` pÃµe as palavras embaixo das notas |
| `lyrics_api.py` | Letra pela base aberta **LRCLIB** (sem chave; muitas com tempo por linha). Adivinha artista e mÃºsica pelo nome do arquivo e escolhe a versÃ£o de duraÃ§Ã£o mais parecida |
| `notation.py` | MusicXML compasso a compasso, voz Ãºnica: barras de ritmo nos compassos sem melodia, notas e pausas cortadas nas trocas de acorde, pausas agrupadas, ligaduras; MIDI com melodia e acordes |

Ferramenta de desenvolvimento: `tools/avaliar_cifras.py` (a "prova das cifras"). Compara os acordes de cada mÃºsica com o gabarito em `data/gabarito/<id>.json` (sÃ³ nomes de acordes, sem letra) e dÃ¡ a nota em 4 nÃ­veis: raiz, maior/menor, com baixo e sÃ©timas. **Toda mudanÃ§a nos acordes precisa subir a mÃ©dia sem derrubar nenhuma mÃºsica.**

Acordes por tempo usam Viterbi com custo de troca por posiÃ§Ã£o no compasso (barato no 1 e no 3). Dois nÃ­veis: **simples** (junta trocas rÃ¡pidas) e **detalhado** (mostra todas).

### Dados de cada mÃºsica (`data/songs/<id>/`)

- `meta.json` (tÃ­tulo, status, progresso, tom, BPM), `source.*` (original)
- `stems/*.m4a` (voz, harmonia, baixo, percussÃ£o para o player); `work/*.wav` (mono 22 kHz para anÃ¡lise)
- `work/lyrics.json` (letra automÃ¡tica, cache), `work/lyrics_user.json` (letra corrigida; tem prioridade)
- `analysis.json`: `grid` (tempos), `bpm`, `key`, `time_signature`, `beat_ql` (1 em 4/4, 1,5 em 12/8), `subdivision`, `chords` (simples), `chords_detalhado`, `melody` (notas por nÃ­vel), `lyrics`, `lyrics_source`, `octave_shift`, `has_vocals`
- `score_simples.musicxml`, `score_detalhado.musicxml`, `transcricao.mid`

### Frontend (`web/`)

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Telas: inÃ­cio, processando, erro, leitor, Modo palco, Modo Show, janela de corrigir letra |
| `style.css` | Identidade **preto e branco**: preto puro, painÃ©is `#0a0a0a` sem borda, branco para aÃ§Ã£o e destaque, cinzas no resto; tÃ­tulos em Fraunces (com itÃ¡lico) e texto em Figtree. Capas em P&B com 4 desenhos (vinil, pauta, retÃ­cula, listras) |
| `app.js` | Estado `S`, biblioteca, player com as partes sincronizadas (ver "Motor de Ã¡udio"), partitura (OSMD) com cursor, acordes por nÃ­vel, karaokÃª, repetir trecho, metrÃ´nomo, mixer, Modo palco, Modo Show (esteira + jogo + escolha do fundo), corrigir letra, mÃ£o do acorde, logo que ondula tocando. Com `?debug` na URL, expÃµe `window.pv` para medir a sincronia no console |
| `chords.js` | Diagramas de acorde no violÃ£o (formas de E e de A e abertos), `fingering()` (qual dedo em cada nota) e `neck()`: o braÃ§o do violÃ£o deitado com a bolinha numerada de cada dedo e a pestana |
| `viz.js` | AnimaÃ§Ã£o do topo da mÃºsica, em P&B (nÃ©voas de luz e barras do som) |
| `stage.js` | Cena da roda de samba com mÃºsicos em silhuetas; `mono` tira a cor no fim do quadro (uma passada `saturation`) |
| `mesa.js` | Cena **"mesa de samba"** sem pessoas, em P&B: lua sobre a baÃ­a, morros, bondinho, varal de lÃ¢mpadas, chapÃ©u, tamborim, pandeiro, cavaquinho, chopp e partitura na mesa. Fundo padrÃ£o do Modo Show e da tela inicial |
| `game.js` | Microfone: modo **acordes** (croma por tempo) e modo **melodia** (YIN, nota por nota) |
| `vendor/` | OpenSheetMusicDisplay 1.9.0 e fontes (Figtree, Fraunces) |

**Modo Show:** a partitura numa linha sÃ³ (`renderSingleHorizontalStaffline`) desliza por baixo de uma linha fixa (tempo â†’ posiÃ§Ã£o x pelas posiÃ§Ãµes do cursor). A cena do palco Ã© desenhada acima da esteira. HÃ¡ fundo opcional com vÃ­deo ou foto da prÃ³pria pessoa (dura atÃ© fechar o app).

**Mesa de som** (botÃ£o de faders na barra de baixo; painel que sobe e cobre a parte de baixo da tela, fecha no Ã— ou Esc):
- Canais: equalizador (corte de grave, grave, mÃ©dio com largura, agudo, corte de agudo), pan, mudo/solo (Alt + clique = solo sÃ³ deste), fader de âˆ’âˆž a +6 dB com escala fina perto do 0 dB, medidor estÃ©reo de pico com marca do maior pico recente e luz de "passou de 0 dB".
- Master: equalizador grÃ¡fico de 10 bandas, fader, limitador (teto âˆ’0,5 dB, mostra quanto estÃ¡ segurando; com o desconto do ganho automÃ¡tico do compressor do WebAudio, abaixo do teto o volume Ã© o original) e pico desde o Ãºltimo clique.
- Aba Equalizador: grÃ¡fico de 20 Hz a 20 kHz com a curva, pontos arrastÃ¡veis (rodinha = largura do mÃ©dio) e analisador de espectro ao vivo (FFT 8192, inclinaÃ§Ã£o de 4,5 dB por oitava). Presets por canal e do master. A curva Ã© desenhada com as mesmas fÃ³rmulas do WebAudio (`biquadDb`).
- Atalhos (sÃ³ volume/mudo/solo), "Minhas mixagens" (`localStorage` `pv.mixPresets`, valem para qualquer mÃºsica) e ajuste por mÃºsica (`pv.mix.<id>`, com `_bus` para o master). Valores guardados sÃ£o conferidos e limitados ao carregar (`cleanStrip`, `cleanBus`).
- Grafo: `entrada â†’ corte de grave â†’ grave â†’ mÃ©dio â†’ agudo â†’ corte de agudo â†’ pan â†’ fader â†’ mudo â†’ master`; master `EQ â†’ fader â†’ limitador â†’ desconto â†’ volume do fone â†’ saÃ­da` (o limitador atrasa 6 ms: o tempo da tela e o metrÃ´nomo descontam).

**Motor de Ã¡udio (sincronia do cursor):**
- Velocidade normal: as 6 partes sÃ£o decodificadas (`decodeAudioData`) e tocam como `AudioBufferSourceNode` comeÃ§ando na **mesma amostra** do relÃ³gio do WebAudio. Pulo e troca de trecho param as antigas e comeÃ§am as novas no mesmo instante agendado (sem buraco); "repetir trecho" usa o `loop` da prÃ³pria fonte. MemÃ³ria: cerca de 2,1 MB por segundo de mÃºsica (6 partes estÃ©reo); acima de 1,1 GB fica no modo `<audio>`.
- Velocidade reduzida: um `<audio>` por parte (tom preservado), realinhados a cada 700 ms se escaparem mais de 30 ms.
- Todas passam por um ganho (mesa de som) e um medidor por parte, e somam no analisador das animaÃ§Ãµes.
- Tempo da tela = o que **sai no fone** (`getOutputTimestamp`; no modo `<audio>`, `currentTime` menos `outputLatency + baseLatency`, porque o `currentTime` do `<audio>` ligado ao WebAudio Ã© o que entra no WebAudio, medido: ~50 ms Ã  frente do fone) **mais 50 ms** (`VISUAL_LEAD`: a imagem leva 2 a 3 quadros para aparecer). Ajuste fino por pessoa no menu de velocidade ("Cursor Ã— som", `localStorage` `pv.syncMs`).
- O cursor pula para cada nota no **instante real** em que ela Ã© cantada (`melody_times`) ou tocada no violÃ£o (4Âº campo de `violao`), nÃ£o no tempo arredondado da partitura: na partitura simples desta mÃºsica o arredondamento chegava a 104 ms (metade das notas acima de 50 ms). Pausas, ligaduras e compassos sem melodia seguem a grade.
- MetrÃ´nomo agendado no relÃ³gio de Ã¡udio (120 ms Ã  frente), nÃ£o na tela.
- Servidor manda `Cache-Control: no-cache` em tudo (o navegador confere pelo ETag): sem isso, o navegador usava `app.js`, partitura e partes de Ã¡udio antigas depois de atualizar ou refazer a mÃºsica.

## DecisÃµes e aprendizados

- **Computador do usuÃ¡rio Ã© fraco** (i5-3470, Intel HD, 8 GB): nada de `backdrop-filter`/blur ou filtros CSS em Ã¡reas grandes; cenas em canvas a 30 fps com camadas fixas prÃ©-desenhadas (a roda gasta cerca de 5 ms por quadro). SeparaÃ§Ã£o leva cerca de 3 a 4 vezes a duraÃ§Ã£o da mÃºsica.
- **Identidade prÃ³pria**: nÃ£o copiar o Spotify nem outro produto (risco jurÃ­dico). Sem o verde `#1ed760`. O usuÃ¡rio escolheu **preto e branco, bem estilizado, sem bordas**, mantendo as posiÃ§Ãµes dos controles (barra lateral, painel principal, barra de tocar embaixo).
- **Marca**: a pauta que vira onda de som (5 linhas retas com uma nota que ondulam Ã  direita), num quadrado branco, e o nome "Pauta *Viva*" com "leia tocando" embaixo. Enquanto a mÃºsica toca, a onda da marca anda (`waveLogo` no `app.js`).
- **Letra**: o reconhecimento acerta o tempo, mas erra palavras em voz cantada ("pra te ter" vira "prateleira"). Ordem: letra colada pela pessoa > base LRCLIB > reconhecimento. Pesquisado em 14/10/2026: Vagalume (API fora do ar e exigia chave), Letras.mus.br e Cifra Club (sem API; o "cifraclub-api" do GitHub Ã© robÃ´ nÃ£o oficial, viola os termos: **nÃ£o usar**), lyrics.ovh (sem a mÃºsica). Para vender: licenÃ§a Musixmatch/LyricFind (ou parceria com a Studio Sol, dona do Letras e do Cifra Club). Letras de mÃºsicas sÃ£o protegidas por direito autoral: nÃ£o escrevÃª-las em respostas, cÃ³digo ou documentos; testar sÃ³ com nÃºmeros ou frases inventadas.
- **Acordes**: a referÃªncia humana Ã© o Cifra Club. Ajuste sÃ³ entra se melhorar a prova (`tools/avaliar_cifras.py`) em **vÃ¡rias** mÃºsicas; ajustar olhando uma mÃºsica sÃ³ Ã© remendo. Gabarito guarda sÃ³ os acordes (sem letra), copiados por nÃ³s uma vez; o usuÃ¡rio final nÃ£o copia nada.
- **ViolÃ£o**: a separaÃ§Ã£o em 6 partes isola o violÃ£o (casa mÃ©dia 3-4, regiÃ£o normal do pagode); na de 4 partes o violÃ£o vinha misturado com cavaco e teclado (casa mÃ©dia 7).
- **Cifra Club nÃ£o Ã© a gravaÃ§Ã£o**: Ã© uma versÃ£o para tocar, feita por uma pessoa. Em "Frases de Amor" o baixo gravado toca FÃ¡ onde o Cifra escreve Fm/Eâ™­. O gabarito vale para raiz e maior/menor; o baixo tem que seguir o que estÃ¡ gravado (conferir com as notas do baixo separado).
- **Compasso**: `estimate_meter` decide pela pulsaÃ§Ã£o, onde os acordes trocam e andamento confortÃ¡vel. Ainda instÃ¡vel em mÃºsica ambÃ­gua (Frases de Amor oscilou entre 12/8 a 96 e 4/4 a 144; os nÃºmeros indicam 4/4, talvez a 72). Precisa de gabarito de compasso e BPM (perguntar ao usuÃ¡rio como ele conta).
- **Testado e descartado**: regra do baixo por nota (`spell_with_bass`) piorou a prova contra o Cifra (mas o Cifra nÃ£o Ã© a gravaÃ§Ã£o: reavaliar com gabarito melhor).
- **Partitura**: cores claras pelas regras do OSMD (`DefaultColor*`), nÃ£o por filtro CSS. A classe CSS `show` Ã© do Modo Show: nÃ£o usar esse nome para estados de outros elementos (jÃ¡ causou bug).
- **MÃ£o desenhada no braÃ§o**: testada e reprovada pelo usuÃ¡rio ("dedo de alienÃ­gena"). Mostrar sÃ³ a posiÃ§Ã£o dos dedos (bolinhas numeradas).
- **12/8**: um tempo da anÃ¡lise = semÃ­nima pontuada (`beat_ql = 1,5`).
- **Windows**: caminhos com mais de 260 caracteres quebram o Python; scripts de teste vÃ£o em `%TEMP%`. No PowerShell nÃ£o existe `&&`.

## Instalador do Windows (`instalador/`)

- `soundStudy.iss` (Inno Setup 6.7, modo escuro) gera `dist\soundStudy-Setup-<versÃ£o>.exe` (38 MB), que vai para as
  **Releases** do GitHub (o `dist/` fica fora do Git). Telas: boas-vindas, **Sobre o programa** (objetivo 100%
  didÃ¡tico, o que precisa de internet, requisitos mÃ­nimos e recomendados), **Termo de uso e responsabilidade**
  (aceito/nÃ£o aceito; inclui que nÃ£o nos responsabilizamos pela divulgaÃ§Ã£o nÃ£o autorizada das partituras), pasta,
  atalho, instalaÃ§Ã£o e conclusÃ£o. Desinstalador em "Aplicativos" (pergunta se apaga as mÃºsicas transcritas).
- Instala por usuÃ¡rio em `%LOCALAPPDATA%\Programs\soundStudy` (sem administrador). Baixa o **Python 3.12.10 oficial
  do NuGet** (conferido pelo SHA-256) para `python\tools`, cria o `.venv`, instala os componentes (PyTorch com CUDA
  se houver `nvidia-smi`) e grava os marcadores que o `iniciar.bat` usa (`pauta_requirements.txt`, `atalho_criado`).
- `gerar.py` gera as imagens (marca em P&B) e os textos RTF; o nome do app fica em `NOME` lÃ¡ e em `AppName` no `.iss`.
- A extraÃ§Ã£o automÃ¡tica do Inno nÃ£o entra em subpastas quando o arquivo Ã© baixado: o Python Ã© extraÃ­do no `[Code]`.
- O Inno Setup pede licenÃ§a comercial quando usado para vender software.
- Testado neste PC com instalaÃ§Ã£o silenciosa numa pasta temporÃ¡ria e desinstalaÃ§Ã£o (limpa pasta, atalho e registro).

## Rodar no notebook com placa de vÃ­deo

1. Instalar o Python 3.12 (python.org, marcar "Add to PATH").
2. Copiar a pasta do projeto **sem** a pasta `.venv` (ela nÃ£o funciona em outro computador). Levar `data/models/` economiza o download de 667 MB.
3. Dois cliques no `iniciar.bat`: ele cria o ambiente, vÃª a placa NVIDIA (`nvidia-smi`), instala o PyTorch com CUDA (cu124) e as bibliotecas cuBLAS/cuDNN para a letra na placa, e abre o app. Na primeira vez baixa os modelos (separaÃ§Ã£o, Whisper `large-v3` ~3 GB).
4. A engrenagem no topo mostra a placa encontrada; no modo AutomÃ¡tica a separaÃ§Ã£o jÃ¡ vai na mÃ¡xima.

## PreferÃªncias do usuÃ¡rio

- PortuguÃªs, respostas curtas, diretas e visuais (prints e telas valem mais que texto longo).
- Iniciante em leitura de partitura; toca violÃ£o.
- Quer algo profissional, elegante e prÃ³prio.

## Estado atual (14/10/2026)

Pronto e testado:
- TranscriÃ§Ã£o completa: separaÃ§Ã£o, pulso, 4/4 ou 12/8, tom, acordes (BTC, dois nÃ­veis), melodia, letra automÃ¡tica, partitura e MIDI.
- Leitor: partitura com cursor, cifras, diagramas, karaokÃª, loop, metrÃ´nomo, velocidade, mixer e Modo palco.
- Modo Show: esteira fluida, roda de samba animada, jogo com microfone (acordes e melodia; testado com tons gerados, ainda nÃ£o com instrumento real).
- Bugs corrigidos: cifras sobrepostas, voz escondida na partitura, barra do topo invadindo a tela, faixa de cifras cobrindo a partitura.
- Corrigir letra: encaixe da letra colada testado no servidor.
- Identidade preto e branco aplicada em todas as telas (inÃ­cio, leitor, Modo palco, Modo Show, janelas), logo nova, favicon, capas P&B.
- Tela inicial com a mesa de samba animada no topo; Modo Show com fundo "Mesa de samba Ã  noite" (padrÃ£o), "Roda de samba com mÃºsicos" (em P&B) ou vÃ­deo/foto prÃ³prio; a escolha da cena fica guardada (`localStorage` `pv.scene`).
- Card "Como tocar" na barra lateral: o braÃ§o do violÃ£o mostra onde vai cada dedo no acorde atual (antes do primeiro acorde mostra "Prepare").

- SeparaÃ§Ã£o em 6 partes, nÃ­vel "ViolÃ£o" (tablatura + braÃ§o com as notas ao vivo), mixer com 6 canais e "Sem o violÃ£o (toque vocÃª)".
- Letra pela base aberta (LRCLIB) com busca na tela e atalho para o Letras; reconhecimento sÃ³ como reserva.
- Tom confirmado pelos acordes (Frases de Amor: Miâ™­ maior, igual ao Cifra Club). Modelo de acordes de vocabulÃ¡rio grande ligado.
- Prova das cifras (Frases de Amor, trecho de 23 acordes): raiz 78%, maior/menor 78%, com baixo 65%, sÃ©timas 70%.

- Mesa de som virtual (botÃ£o de faders na barra de baixo): fader vertical em dB por parte, medidor ao vivo, mudo/solo, presets ("Sem o violÃ£o (toque vocÃª)") e ajuste salvo por mÃºsica (`localStorage` `pv.mix.<id>`).
- Modo de qualidade com detecÃ§Ã£o da mÃ¡quina e separaÃ§Ã£o mÃ¡xima (BS-RoFormer SW) prontos; o usuÃ¡rio vai testar no notebook com placa de vÃ­deo.
- Letra na partitura por **sÃ­laba** (separaÃ§Ã£o silÃ¡bica do portuguÃªs, hÃ­fen entre sÃ­labas, melisma quando a nota sobra) e encaixada no instante real das notas.
- Cursor preciso (motor de Ã¡udio sincronizado por amostra + instante real das notas), testado no navegador: posiÃ§Ã£o certa em 229 de 230 quadros, velocidade reduzida, repetiÃ§Ã£o sem buraco e metrÃ´nomo.
- Mesa de som profissional (ver Frontend), testada no navegador: arrastar pontos do grÃ¡fico, rodinha, cortes, mixagens salvas, "Zerar tudo".
- Corrigido: ao abrir outra mÃºsica, a frase da letra da mÃºsica anterior ficava na tela atÃ© a nova comeÃ§ar (`resetLyrics`).
- **Capa e cor da mÃºsica** (`app/cover.py`): capa embutida no arquivo ou da loja do iTunes (busca pÃºblica, 1200Ã—1200
  quando hÃ¡; evita coletÃ¢nea de vÃ¡rios artistas); a cor de destaque Ã© a mais viva da capa (votaÃ§Ã£o por fatias da roda de
  cores). A tela usa `--song`, `--song-hi`, `--song-head`, `--song-deep` e `--song-ink`: topo da pÃ¡gina em degradÃª (como
  nos players de mÃºsica), botÃµes, chips, barras, karaokÃª, cursor, animaÃ§Ã£o e mesa de som. Sem capa: cor do tom pelo
  cÃ­rculo das quintas. Para vender: licenÃ§a das capas ou desligar `BUSCAR_NA_INTERNET`.
- **Modo Show**: fundo padrÃ£o Ã© a **foto do artista** (a capa), com movimento lento e pulso no 1 do compasso; mesa,
  roda e vÃ­deo/foto prÃ³prio continuam como opÃ§Ã£o (escolha em `localStorage` `pv.fundo`).
- Identidade: o usuÃ¡rio pediu cor (capa) em cima da base preta; tirou o "leia tocando" da marca.
- Mesa de samba: violÃ£o clÃ¡ssico em pÃ© na ponta da mesa (o deitado parecia "tÃ¡bua"); sem cerveja e sem garrafa
  (o usuÃ¡rio nÃ£o gostou). Ãcones de cada instrumento na mesa de som.
- SeparaÃ§Ã£o: o analisador da mesa mostra que o baixo do modo rÃ¡pido (Demucs) quase nÃ£o tem som acima de ~300 Hz (fica "abafado"); o modo MÃ¡xima (BS-RoFormer) Ã© a soluÃ§Ã£o, no notebook com placa NVIDIA.

PrÃ³ximos passos (nesta ordem):
1. **Gabarito com 10 a 15 mÃºsicas** (o usuÃ¡rio manda MP3 + cifra do Cifra Club; guardar sÃ³ os acordes, mais compasso e BPM). SÃ³ com isso dÃ¡ para melhorar acordes e compasso sem remendo.
2. Compasso: tornar `estimate_meter` estÃ¡vel e medir contra o gabarito; acordes que trocam no meio do tempo quando o tempo Ã© lento.
3. Baixo: usar o baixo transcrito para inversÃµes que a gravaÃ§Ã£o mostra (validar no gabarito).
4. Testar no notebook com placa de vÃ­deo (separaÃ§Ã£o mÃ¡xima, letra `large-v3`) e o instalador numa mÃ¡quina limpa.
5. Publicar no GitHub do usuÃ¡rio, em repositÃ³rio **privado** (falta instalar o Git, com permissÃ£o do usuÃ¡rio).
6. Testar "Corrigir letra" e o Modo Show valendo pontos com microfone real.
7. **Segunda parte do sistema (separada deste app):** aplicaÃ§Ã£o web de **teoria musical** completa e intuitiva, **mais grÃ¡fica do que escrita**, com **apresentaÃ§Ãµes**, **provas** e **questÃµes**. Pedido do usuÃ¡rio em 14/10/2026.
8. **Login** (conta da pessoa), junto com a parte web.
9. Por Ãºltimo: rede social (decisÃ£o do usuÃ¡rio).
10. Nome: o usuÃ¡rio nÃ£o gostou de "soundStudy" (14/10/2026); estÃ¡ escolhendo outro. O repositÃ³rio pode ser renomeado no GitHub sem perder nada.
