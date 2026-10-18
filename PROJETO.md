# soundStudy

App que transforma uma música (MP3, WAV, M4A…) em **partitura, cifras e letra sincronizadas com o áudio**, para quem está aprendendo a ler e tocar. Roda no computador do usuário (Windows), sem internet depois de instalado.

Plano de negócio (Claude Docs): https://claude.ai/code/artifact/d81bf2c1-bd90-4429-a404-7c07d69bf033

## Visão do produto

- Hoje: ferramenta local de transcrição e estudo (partitura + cifras + letra + jogo).
- Futuro: **rede social educativa de músicos**. Cada música tem a partitura automática e vídeos de músicos tocando; a comunidade vota e o mais votado vira o **vídeo padrão** daquela música (por instrumento e nível).
- Público: louvor, pagode e sertanejo, do iniciante ao profissional. Lançamento com **louvor e pagode**.
- Começo com cerca de **R$ 100**, app primeiro (o site da rede vem depois).
- **Premium**: transcrições ilimitadas, nível detalhado, Modo Show valendo pontos (microfone), entre outros. Nesta versão de teste o Premium está liberado (`PREMIUM_LIBERADO` em `web/app.js`).

## Como rodar

- Pasta: `C:\Users\Make\Documents\soundStudy` (pasta de desenvolvimento, ainda com o nome antigo)
- Usuário final: dois cliques em `iniciar.bat` (na primeira vez cria o `.venv` e instala o `requirements.txt`; abre `http://127.0.0.1:8765`). Se o servidor já estiver no ar, só abre o navegador.
- Desenvolvimento:
  - `.venv\Scripts\python.exe -m uvicorn app.server:app --host 127.0.0.1 --port 8765`
  - **Reinicie o servidor depois de mudar qualquer arquivo Python** (o frontend é servido direto do disco: basta recarregar a página).
- Python 3.12 (venv em `.venv`). Torch 2.5.1 CPU, Demucs, librosa 1.0, music21, FastAPI, faster-whisper.
- Na primeira transcrição o app baixa modelos: Demucs htdemucs (~80 MB) e Whisper small (~480 MB).

## Arquitetura

### Backend (`app/`)

| Arquivo | O que faz |
| --- | --- |
| `server.py` | FastAPI: `/api/songs` (listar, enviar, ver, renomear, excluir, reprocessar), `/api/songs/{id}/lyrics` (GET texto atual, PUT letra colada; vazio desfaz), `/lyrics/search` (versões na base de letras) e `/lyrics/use` (usa a versão escolhida), `/api/stages`, arquivos em `/files` e frontend em `/static` |
| `pipeline.py` | Fila com um worker. Etapas: `convert` → `separate` (Demucs **htdemucs_6s**: voz, violão, teclado, outros, baixo, percussão) → `rhythm` → `harmony` → `melody` → `violao` → `lyrics` → `score`. Grava `meta.json` e `analysis.json`. Músicas antigas (4 partes) são separadas de novo ao reprocessar. `save_lyrics`, `use_api_lyrics` e `rebuild_scores` refazem as partituras em segundos |
| `analysis.py` | Pulso (librosa + correção de contratempo pelo bumbo/baixo), levada binária ou ternária (4/4 ou 12/8), tom (perfil de Krumhansl e depois **confirmado pelos acordes**: `key_from_chords`), acordes (modelo BTC; reserva por croma), melodia (pYIN → eventos de nota → grade). `spell_with_bass` (baixo nota a nota) existe mas **não está ligado**: piorou a prova |
| `lvcr/` | **Modelo de acordes em uso**: Jiang et al., "Large-Vocabulary Chord Transcription via Chord Structure Decomposition" (ISMIR 2019, MIT). Decompõe o acorde em tríade + baixo + 7ª + 9ª + 11ª + 13ª; vocabulário com inversões e baixo pedal (m/b7, maj/2, maj/3, maj/5…), 7M(9), m7(9), 7(9), 7(11), 7(13), 7(4). 5 redes (5,5 MB cada) votam; ~35 s por música no PC do usuário. Pesos carregados com `weights_only=True` |
| `chord_model.py` + `app/btc/` | BTC (Park et al., ISMIR 2019, licença MIT): 170 acordes. Reserva se `lvcr/` faltar. Ajustes locais: `yaml.safe_load` e `np.float` → `float` |
| `hardware.py` | **Modo de qualidade** (`data/config.json`: auto, rápida, máxima). Detecta placa NVIDIA (CUDA) e decide: separação máxima, Whisper `large-v3` na placa e animações em resolução cheia a 60 quadros; sem placa: rápida, `small`, animações leves. `/api/config` (GET/PUT) e engrenagem no topo da tela |
| `separation.py` | Dois motores, mesmas 6 partes. **Rápida**: Demucs htdemucs_6s (MIT); confunde violão de nylon com piano às vezes (intro, finais). **Máxima**: BS-RoFormer SW (pacote `bs-roformer-infer`, código MIT, pesos de 667 MB em `data/models/`, **licença dos pesos desconhecida**: só teste/uso pessoal até resolver). Na placa de vídeo leva minutos; no PC sem placa, horas. "Refazer com separação máxima" no menu da música |
| `basicpitch/` | Basic Pitch (Spotify, Apache 2.0), só o modelo ONNX de 230 KB e a decodificação de notas adaptada (sem TensorFlow). ~5 s por parte da música no PC do usuário |
| `violao.py` | **Instrumentos** nota por nota (`INSTRUMENTS`: violão, cavaco D-G-B-D, baixo 4 cordas, teclado): Basic Pitch na parte de cada um (cavaco vem de "other", só a região dele) → ataques (notas juntas até 45 ms viram acorde; baixo: uma nota e sem o harmônico da oitava de cima, `_drop_octave_ghosts`) → corda e casa por Viterbi → MusicXML com pauta + **tablatura** (violão, cavaco, baixo em clave de fá 8vb) ou pauta dupla (teclado, sem tablatura), cifras em cima (`score_<instrumento>.musicxml`) |
| `cifra.py` | Cifra no jeito brasileiro: `parse_symbol` (D6(9), G7M(5-), A7(4/9), A7+, E79, C#m5-/7...), as partes do modelo de acordes (`lvcr_parts`) e os acordes de um texto de cifra colado (`parse_text`; rótulos como "[Intro]" e "(2x)" funcionam; a letra é ignorada e **nunca guardada**) |
| `celular.py` | Abrir no celular: IP da rede, **chave de acesso** (`chave_celular` no config.json), link e QR code (pacote `segno`) |
| `tunel.py` | Acesso de fora de casa: túnel **Cloudflare** (quick tunnel, `data/bin/cloudflared.exe`) ou, sem ele, SSH + localhost.run (lento). Roda num processo à parte (aberto pelo `Start-Process` do PowerShell) e **sobrevive a reinícios do servidor** com o mesmo link (estado em `data/bin/tunel.json`); um vigia reabre se cair. Desliga só pelo botão do app |
| `lyrics.py` | Letra: faster-whisper (`PAUTA_WHISPER_MODEL`, padrão `small`) na voz separada; `align_text` encaixa letra colada; `align_synced` encaixa letra com tempo por linha (LRC) achando o atraso e espalhando as sílabas pelas notas cantadas; `words_on_notes` põe as palavras embaixo das notas |
| `lyrics_api.py` | Letra pela base aberta **LRCLIB** (sem chave; muitas com tempo por linha). Adivinha artista e música pelo nome do arquivo e escolhe a versão de duração mais parecida |
| `notation.py` | MusicXML compasso a compasso, voz única: barras de ritmo nos compassos sem melodia, notas e pausas cortadas nas trocas de acorde, pausas agrupadas, ligaduras; MIDI com melodia e acordes |

Ferramenta de desenvolvimento: `tools/avaliar_cifras.py` (a "prova das cifras"). Compara os acordes de cada música com o gabarito em `data/gabarito/<id>.json` (só nomes de acordes, sem letra) e dá a nota em 4 níveis: raiz, maior/menor, com baixo e sétimas. **Toda mudança nos acordes precisa subir a média sem derrubar nenhuma música.**

Acordes por tempo usam Viterbi com custo de troca por posição no compasso (barato no 1 e no 3). Dois níveis: **simples** (junta trocas rápidas) e **detalhado** (mostra todas).

### Dados de cada música (`data/songs/<id>/`)

- `meta.json` (título, status, progresso, tom, BPM), `source.*` (original)
- `stems/*.m4a` (voz, harmonia, baixo, percussão para o player); `work/*.wav` (mono 22 kHz para análise)
- `work/lyrics.json` (letra automática, cache), `work/lyrics_user.json` (letra corrigida; tem prioridade)
- `analysis.json`: `grid` (tempos), `bpm`, `key`, `time_signature`, `beat_ql` (1 em 4/4, 1,5 em 12/8), `subdivision`, `chords` (simples), `chords_detalhado`, `melody` (notas por nível), `lyrics`, `lyrics_source`, `octave_shift`, `has_vocals`
- `score_simples.musicxml`, `score_detalhado.musicxml`, `transcricao.mid`

### Frontend (`web/`)

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Telas: início, processando, erro, leitor, Modo palco, Modo Show, janela de corrigir letra |
| `style.css` | Identidade **preto e branco**: preto puro, painéis `#0a0a0a` sem borda, branco para ação e destaque, cinzas no resto; títulos em Fraunces (com itálico) e texto em Figtree. Capas em P&B com 4 desenhos (vinil, pauta, retícula, listras) |
| `app.js` | Estado `S`, biblioteca, player com as partes sincronizadas (ver "Motor de áudio"), partitura (OSMD) com cursor, acordes por nível, karaokê, repetir trecho, metrônomo, mixer, Modo palco, Modo Show (esteira + jogo + escolha do fundo), corrigir letra, mão do acorde, logo que ondula tocando. Com `?debug` na URL, expõe `window.pv` para medir a sincronia no console |
| `chords.js` | Diagramas de acorde no violão (formas de E e de A e abertos), `fingering()` (qual dedo em cada nota) e `neck()`: o braço do violão deitado com a bolinha numerada de cada dedo e a pestana |
| `viz.js` | Animação do topo da música, em P&B (névoas de luz e barras do som) |
| `stage.js` | Cena da roda de samba com músicos em silhuetas; `mono` tira a cor no fim do quadro (uma passada `saturation`) |
| `mesa.js` | Cena **"mesa de samba"** sem pessoas, em P&B: lua sobre a baía, morros, bondinho, varal de lâmpadas, chapéu, tamborim, pandeiro, cavaquinho, chopp e partitura na mesa. Fundo padrão do Modo Show e da tela inicial |
| `game.js` | Microfone: modo **acordes** (croma por tempo) e modo **melodia** (YIN, nota por nota) |
| `pista.js` | **Pista do braço** em canvas (30 quadros): o braço real e as bolinhas de cada acorde (com a pestana) entrando pela direita e andando para a esquerda até a casa certa na hora de tocar (`drawBoard`, `boardBase`, `shape`); teclado igual; indicadores do jogo e retorno "Perfeito!" (`drawHud`); "Voz" = melodia caindo sobre teclas (`drawVoice`). `orient 'v'` = Modo Show, `'h'` = "Tocando agora". Parada, só redesenha quando algo muda |
| `vendor/` | OpenSheetMusicDisplay 1.9.0 e fontes (Figtree, Fraunces) |

**Modo Show:** a partitura em pedaços de uma linha (`renderSingleHorizontalStaffline` com `drawFrom/UpToMeasureNumber`), colados lado a lado, desliza por baixo de uma linha fixa (tempo → posição x pelas notas de cada pedaço). A cena do palco é desenhada acima da esteira. Há fundo opcional com vídeo ou foto da própria pessoa (dura até fechar o app).

**Mesa de som** (botão de faders na barra de baixo; painel que sobe e cobre a parte de baixo da tela, fecha no × ou Esc):
- Canais: equalizador (corte de grave, grave, médio com largura, agudo, corte de agudo), pan, mudo/solo (Alt + clique = solo só deste), fader de −∞ a +6 dB com escala fina perto do 0 dB, medidor estéreo de pico com marca do maior pico recente e luz de "passou de 0 dB".
- Master: equalizador gráfico de 10 bandas, fader, limitador (teto −0,5 dB, mostra quanto está segurando; com o desconto do ganho automático do compressor do WebAudio, abaixo do teto o volume é o original) e pico desde o último clique.
- Aba Equalizador: gráfico de 20 Hz a 20 kHz com a curva, pontos arrastáveis (rodinha = largura do médio) e analisador de espectro ao vivo (FFT 8192, inclinação de 4,5 dB por oitava). Presets por canal e do master. A curva é desenhada com as mesmas fórmulas do WebAudio (`biquadDb`).
- Atalhos (só volume/mudo/solo), "Minhas mixagens" (`localStorage` `pv.mixPresets`, valem para qualquer música) e ajuste por música (`pv.mix.<id>`, com `_bus` para o master). Valores guardados são conferidos e limitados ao carregar (`cleanStrip`, `cleanBus`).
- Grafo: `entrada → corte de grave → grave → médio → agudo → corte de agudo → pan → fader → mudo → master`; master `EQ → fader → limitador → desconto → volume do fone → saída` (o limitador atrasa 6 ms: o tempo da tela e o metrônomo descontam).

**Motor de áudio (sincronia do cursor):**
- Velocidade normal: as 6 partes são decodificadas (`decodeAudioData`) e tocam como `AudioBufferSourceNode` começando na **mesma amostra** do relógio do WebAudio. Pulo e troca de trecho param as antigas e começam as novas no mesmo instante agendado (sem buraco); "repetir trecho" usa o `loop` da própria fonte. Memória: cerca de 2,1 MB por segundo de música (6 partes estéreo); acima de 1,1 GB fica no modo `<audio>`.
- Velocidade reduzida: um `<audio>` por parte (tom preservado), realinhados a cada 700 ms se escaparem mais de 30 ms.
- Todas passam por um ganho (mesa de som) e um medidor por parte, e somam no analisador das animações.
- Tempo da tela = o que **sai no fone** (`getOutputTimestamp`; no modo `<audio>`, `currentTime` menos `outputLatency + baseLatency`, porque o `currentTime` do `<audio>` ligado ao WebAudio é o que entra no WebAudio, medido: ~50 ms à frente do fone) **mais 50 ms** (`VISUAL_LEAD`: a imagem leva 2 a 3 quadros para aparecer). Ajuste fino por pessoa no menu de velocidade ("Cursor × som", `localStorage` `pv.syncMs`).
- O cursor pula para cada nota no **instante real** em que ela é cantada (`melody_times`) ou tocada no violão (4º campo de `violao`), não no tempo arredondado da partitura: na partitura simples desta música o arredondamento chegava a 104 ms (metade das notas acima de 50 ms). Pausas, ligaduras e compassos sem melodia seguem a grade.
- Metrônomo agendado no relógio de áudio (120 ms à frente), não na tela.
- Servidor manda `Cache-Control: no-cache` em tudo (o navegador confere pelo ETag): sem isso, o navegador usava `app.js`, partitura e partes de áudio antigas depois de atualizar ou refazer a música.

## Decisões e aprendizados

- **Computador do usuário é fraco** (i5-3470, Intel HD, 8 GB): nada de `backdrop-filter`/blur ou filtros CSS em áreas grandes; cenas em canvas a 30 fps com camadas fixas pré-desenhadas (a roda gasta cerca de 5 ms por quadro). Separação leva cerca de 3 a 4 vezes a duração da música.
- **Identidade própria**: não copiar o Spotify nem outro produto (risco jurídico). Sem o verde `#1ed760`. O usuário escolheu **preto e branco, bem estilizado, sem bordas**, mantendo as posições dos controles (barra lateral, painel principal, barra de tocar embaixo).
- **Marca**: a pauta que vira onda de som (5 linhas retas com uma nota que ondulam à direita), num quadrado branco, e o nome "Pauta *Viva*" com "leia tocando" embaixo. Enquanto a música toca, a onda da marca anda (`waveLogo` no `app.js`).
- **Letra**: o reconhecimento acerta o tempo, mas erra palavras em voz cantada ("pra te ter" vira "prateleira"). Ordem: letra colada pela pessoa > base LRCLIB > reconhecimento. Pesquisado em 14/10/2026: Vagalume (API fora do ar e exigia chave), Letras.mus.br e Cifra Club (sem API; o "cifraclub-api" do GitHub é robô não oficial, viola os termos: **não usar**), lyrics.ovh (sem a música). Para vender: licença Musixmatch/LyricFind (ou parceria com a Studio Sol, dona do Letras e do Cifra Club). Letras de músicas são protegidas por direito autoral: não escrevê-las em respostas, código ou documentos; testar só com números ou frases inventadas.
- **Acordes**: a referência humana é o Cifra Club. Ajuste só entra se melhorar a prova (`tools/avaliar_cifras.py`) em **várias** músicas; ajustar olhando uma música só é remendo. Gabarito guarda só os acordes (sem letra), copiados por nós uma vez; o usuário final não copia nada.
- **Violão**: a separação em 6 partes isola o violão (casa média 3-4, região normal do pagode); na de 4 partes o violão vinha misturado com cavaco e teclado (casa média 7).
- **Cifra Club não é a gravação**: é uma versão para tocar, feita por uma pessoa. Em "Frases de Amor" o baixo gravado toca Fá onde o Cifra escreve Fm/E♭. O gabarito vale para raiz e maior/menor; o baixo tem que seguir o que está gravado (conferir com as notas do baixo separado).
- **Compasso**: `estimate_meter` decide pela pulsação, onde os acordes trocam e andamento confortável. Ainda instável em música ambígua (Frases de Amor oscilou entre 12/8 a 96 e 4/4 a 144; os números indicam 4/4, talvez a 72). Precisa de gabarito de compasso e BPM (perguntar ao usuário como ele conta).
- **Testado e descartado**: regra do baixo por nota (`spell_with_bass`) piorou a prova contra o Cifra (mas o Cifra não é a gravação: reavaliar com gabarito melhor).
- **Partitura**: cores claras pelas regras do OSMD (`DefaultColor*`), não por filtro CSS. A classe CSS `show` é do Modo Show: não usar esse nome para estados de outros elementos (já causou bug).
- **Mão desenhada no braço**: testada e reprovada pelo usuário ("dedo de alienígena"). Mostrar só a posição dos dedos (bolinhas numeradas).
- **12/8**: um tempo da análise = semínima pontuada (`beat_ql = 1,5`).
- **Windows**: caminhos com mais de 260 caracteres quebram o Python; scripts de teste vão em `%TEMP%`. No PowerShell não existe `&&`.

## Instalador do Windows (`instalador/`)

- `soundStudy.iss` (Inno Setup 6.7, modo escuro) gera `dist\soundStudy-Setup-<versão>.exe` (38 MB), que vai para as
  **Releases** do GitHub (o `dist/` fica fora do Git). Telas: boas-vindas, **Sobre o programa** (objetivo 100%
  didático, o que precisa de internet, requisitos mínimos e recomendados), **Termo de uso e responsabilidade**
  (aceito/não aceito; inclui que não nos responsabilizamos pela divulgação não autorizada das partituras), pasta,
  atalho, instalação e conclusão. Desinstalador em "Aplicativos" (pergunta se apaga as músicas transcritas).
- Instala por usuário em `%LOCALAPPDATA%\Programs\soundStudy` (sem administrador). Baixa o **Python 3.12.10 oficial
  do NuGet** (conferido pelo SHA-256) para `python\tools`, cria o `.venv`, instala os componentes (PyTorch com CUDA
  se houver `nvidia-smi`) e grava os marcadores que o `iniciar.bat` usa (`pauta_requirements.txt`, `atalho_criado`).
- `gerar.py` gera as imagens (marca em P&B) e os textos RTF; o nome do app fica em `NOME` lá e em `AppName` no `.iss`.
- A extração automática do Inno não entra em subpastas quando o arquivo é baixado: o Python é extraído no `[Code]`.
- O Inno Setup pede licença comercial quando usado para vender software.
- Testado neste PC com instalação silenciosa numa pasta temporária e desinstalação (limpa pasta, atalho e registro).

## Rodar no notebook com placa de vídeo

1. Instalar o Python 3.12 (python.org, marcar "Add to PATH").
2. Copiar a pasta do projeto **sem** a pasta `.venv` (ela não funciona em outro computador). Levar `data/models/` economiza o download de 667 MB.
3. Dois cliques no `iniciar.bat`: ele cria o ambiente, vê a placa NVIDIA (`nvidia-smi`), instala o PyTorch com CUDA (cu124) e as bibliotecas cuBLAS/cuDNN para a letra na placa, e abre o app. Na primeira vez baixa os modelos (separação, Whisper `large-v3` ~3 GB).
4. A engrenagem no topo mostra a placa encontrada; no modo Automática a separação já vai na máxima.

## Preferências do usuário

- Português, respostas curtas, diretas e visuais (prints e telas valem mais que texto longo).
- Iniciante em leitura de partitura; toca violão.
- Quer algo profissional, elegante e próprio.

## Estado atual (14/10/2026)

Pronto e testado:
- Transcrição completa: separação, pulso, 4/4 ou 12/8, tom, acordes (BTC, dois níveis), melodia, letra automática, partitura e MIDI.
- Leitor: partitura com cursor, cifras, diagramas, karaokê, loop, metrônomo, velocidade, mixer e Modo palco.
- Modo Show: esteira fluida, roda de samba animada, jogo com microfone (acordes e melodia; testado com tons gerados, ainda não com instrumento real).
- Bugs corrigidos: cifras sobrepostas, voz escondida na partitura, barra do topo invadindo a tela, faixa de cifras cobrindo a partitura.
- Corrigir letra: encaixe da letra colada testado no servidor.
- Identidade preto e branco aplicada em todas as telas (início, leitor, Modo palco, Modo Show, janelas), logo nova, favicon, capas P&B.
- Tela inicial com a mesa de samba animada no topo; Modo Show com fundo "Mesa de samba à noite" (padrão), "Roda de samba com músicos" (em P&B) ou vídeo/foto próprio; a escolha da cena fica guardada (`localStorage` `pv.scene`).
- Card "Como tocar" na barra lateral: o braço do violão mostra onde vai cada dedo no acorde atual (antes do primeiro acorde mostra "Prepare").

- Separação em 6 partes, nível "Violão" (tablatura + braço com as notas ao vivo), mixer com 6 canais e "Sem o violão (toque você)".
- Letra pela base aberta (LRCLIB) com busca na tela e atalho para o Letras; reconhecimento só como reserva.
- Tom confirmado pelos acordes (Frases de Amor: Mi♭ maior, igual ao Cifra Club). Modelo de acordes de vocabulário grande ligado.
- Prova das cifras (Frases de Amor, trecho de 23 acordes): raiz 78%, maior/menor 78%, com baixo 65%, sétimas 70%.

- Mesa de som virtual (botão de faders na barra de baixo): fader vertical em dB por parte, medidor ao vivo, mudo/solo, presets ("Sem o violão (toque você)") e ajuste salvo por música (`localStorage` `pv.mix.<id>`).
- Modo de qualidade com detecção da máquina e separação máxima (BS-RoFormer SW) prontos; o usuário vai testar no notebook com placa de vídeo.
- Letra na partitura por **sílaba** (separação silábica do português, hífen entre sílabas, melisma quando a nota sobra) e encaixada no instante real das notas.
- Cursor preciso (motor de áudio sincronizado por amostra + instante real das notas), testado no navegador: posição certa em 229 de 230 quadros, velocidade reduzida, repetição sem buraco e metrônomo.
- Mesa de som profissional (ver Frontend), testada no navegador: arrastar pontos do gráfico, rodinha, cortes, mixagens salvas, "Zerar tudo".
- Corrigido: ao abrir outra música, a frase da letra da música anterior ficava na tela até a nova começar (`resetLyrics`).
- **Capa e cor da música** (`app/cover.py`): capa embutida no arquivo ou da loja do iTunes (busca pública, 1200×1200
  quando há; evita coletânea de vários artistas); a cor de destaque é a mais viva da capa (votação por fatias da roda de
  cores). A tela usa `--song`, `--song-hi`, `--song-head`, `--song-deep` e `--song-ink`: topo da página em degradê (como
  nos players de música), botões, chips, barras, karaokê, cursor, animação e mesa de som. Sem capa: cor do tom pelo
  círculo das quintas. Para vender: licença das capas ou desligar `BUSCAR_NA_INTERNET`.
- **Modo Show**: fundo padrão é a **foto do artista** (a capa), com movimento lento e pulso no 1 do compasso. Opções:
  **Luzes de show** (`web/luzes.js`: canhões de luz, bokeh e o som virando luz, na cor da música), mesa de samba e
  vídeo/foto próprio (escolha em `localStorage` `pv.fundo`). A roda com músicos desenhados saiu (o usuário achou feia).
- Identidade: o usuário pediu cor (capa) em cima da base preta; tirou o "leia tocando" da marca.
- Mesa de samba: violão clássico em pé na ponta da mesa (o deitado parecia "tábua"); sem cerveja e sem garrafa
  (o usuário não gostou). Ícones de cada instrumento na mesa de som.
- Separação: o analisador da mesa mostra que o baixo do modo rápido (Demucs) quase não tem som acima de ~300 Hz (fica "abafado"); o modo Máxima (BS-RoFormer) é a solução, no notebook com placa NVIDIA.
- **17/10/2026, notebook (RTX 4050, 6 GB)**: a instalação pelo `iniciar.bat` (zip do GitHub, pasta `soundStudy-main`) terminou certa (PyTorch cu124, cuDNN, requirements), mas o servidor caía ao abrir: `data/songs` fica fora do Git e o `server.py` montava `/files` numa pasta que não existia. Corrigido: o servidor cria a pasta antes de montar. Testado: app abre, engrenagem mostra a placa, plano automático = separação máxima + letra `large-v3` na placa. Segundo erro na primeira música: `PermissionError` (Acesso negado) ao trocar `meta.tmp` por `meta.json`; no Windows o `os.replace` falha se outro estiver lendo o arquivo (a tela de progresso lê a toda hora, o antivírus também). Corrigido: `_replace` no `pipeline.py` tenta de novo por até ~2 s. **Essas correções foram feitas no notebook, sem Git: levar para o PC de desenvolvimento e dar commit.**
  Terceiro erro: o pacote da separação máxima imprime emoji e a saída do Python fora do console era cp1252 (caía
  na rápida sem avisar). Corrigido: `server.py` põe a saída em UTF-8 e o `iniciar.bat` liga `PYTHONUTF8=1`.

## Estado atual (17/10/2026, notebook)

**Código no GitHub do usuário (`yanbnt/soundStudy`, privado).** No notebook o Git e o `gh` são portáteis, em
`data/bin` (fora do Git); a credencial é o `gh` (login feito em 17/10/2026).

- **Acordes como na cifra.** O modelo quase nunca ouve 6, 9, 11, 13. Agora o detalhado decide a sétima e as
  extensões pelas **notas que violão, teclado e cavaco tocam** (Basic Pitch), somadas em todos os trechos do mesmo
  acorde (`refine_with_notes`, limites por tipo em `EXT_MIN`, uma nona e uma décima terceira só). Baixo fora do
  acorde com as notas formando acorde em cima dele: o acorde é o do baixo (A/G → G(9/♯11)). Grafia pela função no
  tom (`spell`: B♭ em Ré maior, não A♯). Nome brasileiro (`name_chord`: D6(9), G7M(♯11), A7(4/9), D9 = com nona sem
  sétima). Partitura e instrumentos levam o tipo + graus (`xml_harmony`/`XML_FORM`) e a tela dá a cada combinação o
  nome da análise (`extendedChordNames` no `app.js`).
- **Prova** (`tools/avaliar_cifras.py`, nível novo "completo" = nota por nota): Estonteante completo 19% → 39%;
  Um vencedor raiz 82%, completo 25% (a cifra dele é simplificada: a gravação toca D7M(9) onde ela diz D; o
  simples continua sem extensões). Gabaritos: Estonteante (completo) e Um vencedor (trecho), só acordes.
- **Usar a cifra** (menu ⋯ → "Usar a cifra (acordes)"): a pessoa cola a cifra e o app usa **exatamente** aqueles
  acordes, na ordem, encaixados no tempo (`align_cifra`: anda pela cifra posição por posição, pula/volta com custo,
  troca onde o áudio troca; acordes da cifra pontuados pelo modelo + notas tocadas). Guarda só os nomes
  (`work/cifra_user.json`). Na Estonteante: completo 94% e tempo certo onde a gravação bate com a cifra. Onde a
  gravação toca outro acorde (C7(9) no lugar do A7(4/9), F° no lugar do B7), o da cifra fica no lugar dele.
- **Instrumentos:** botões Violão, Baixo, Cavaco e Teclado na partitura (só aparecem se o instrumento toca).
- **Celular:** tela própria até 700 px (biblioteca em gaveta, instrumentos numa faixa que rola, barra de tocar
  compacta, ícone e manifesto para a tela inicial). O PC continua processando.
  - **Wi-Fi de casa:** engrenagem → "Abrir no celular" (QR code). Servidor em `0.0.0.0`; quem não é o PC precisa da
    chave (`?k=` no link → cookie). "Local" = vem do 127.0.0.1 **e** com Host local e sem cabeçalho de repasse
    (pelo túnel tudo chega pelo 127.0.0.1).
  - **Fora de casa:** na mesma janela, "Ligar acesso pela internet" (túnel Cloudflare, ~7,8 MB/s; o endereço muda a
    cada vez que liga). O localhost.run (SSH) fica de reserva, mas dá ~50 KB/s.
- Revisão independente do código (22 agentes, 16 achados confirmados, todos corrigidos): rótulos "[Intro]" na
  cifra, 7(♯5)/7M(♯5)/7(2)/7M(4)/E5 perdendo notas, 7(4) virando "4", 5- guardado como ♯11, Am(7+)/C7(-9), faixa do
  teclado e do cavaco, salvar a cifra trocando de música.
- Para teste/uso pessoal: as letras da base LRCLIB e as capas do iTunes continuam pendentes de licença para vender.
- **Desenho de cada instrumento** (`web/chords.js`): nos níveis Violão/Baixo/Cavaco/Teclado, "Acorde agora",
  "Próximo", palco e o cartão "Como tocar" mostram o instrumento escolhido. Braço com cabeça e tarraxas (6 no
  violão, 4 no cavaco, 4 grandes no baixo), nome da nota de cada corda, número da casa e dedos numerados; baixo
  com a nota do baixo do acorde (nome na bolinha); teclado com teclas de verdade, faixas "mão esquerda/direita", Dó
  central e nomes na grafia do tom. Formas calculadas pela afinação (`searchFrets`, com cache), também para
  acordes de violão sem forma pronta (D6(9), 7(2), E5). No celular o cartão vai para baixo de "Tocando agora".
- **Tempo da voz × partitura e letra** (investigação com agentes e verificação independente, 3 músicas):
  - melodia: confiança mínima do pYIN 0,25 → 0,10; na mesma casa fica o instante do 1º ataque; começo de frase
    recua até 0,15 s se a voz já está na nota (`extend_phrase_starts`). Canto sem nota: 20/36/32% → 13/20/22%;
  - letra: atraso da LRC pelas respirações (`lrc_offset`, busca limitada pela duração); linha começa na
    respiração e vai até a próxima; Whisper roda sempre e o início da palavra é puxado para a nota
    (`snap_words`); análise e "refazer letra" usam os mesmos trechos (`voice_events`). Não Vou Entregar: letra
    estava 3,2 s fora (uma frase), agora +0,35 s; palavras no início de nota 72/21/80% → 94/85/96%;
  - player: áudio suspenso no celular pausa de verdade (cursor não corre sozinho); rolar com o dedo pausa o
    acompanhamento por 3 s.
  - Ficou de fora (medido, efeito pequeno ou arriscado): grade dos tempos ~30 ms atrasada; dividir nota em
    sílabas da mesma altura; coro.
- **Mesa de som no celular** (o usuário reprovou os faders verticais em miniatura): no celular a mesa vira uma
  **lista de instrumentos** (`#cxPhone`, rola para baixo): ícone e nome grandes, volume **deitado** com o
  deslizante do próprio celular (bolinha de 34 px, mesma escala em dB dos faders), Mudo/Solo de 46 px e o
  "Volume geral" com o limitador. Os faders da mesa de estúdio continuam no computador (a coluna inteira do
  fader pega o arrasto). Equalizador em uma coluna no celular.
- **Modo Show sem tela preta e abrindo rápido.** A esteira era a música inteira numa linha só: o SVG passava de
  32.767 px (limite do OSMD/navegador), o resto ficava preto, e abrir levava 8 s (simples) a 15 s (teclado). Agora
  vai em **pedaços** (até 8 compassos e 160 notas cada, `STRIP_BARS`/`STRIP_NOTES`), desenhados fora da tela e
  colados um no outro; clave/armadura só no 1º; altura da pauta igual em todos. Abre em 0,2 s (simples/teclado)
  e 0,7 s (violão). No violão cheio (batida em semicolcheias, ~100 notas por compasso) cada compasso leva ~0,25 s
  para desenhar e a esteira dá um tranco nessa hora. Números da tablatura apareciam brancos no branco: corrigido.
- **Baixo com uma nota só** no desenho do acorde: a do baixo (C7 → Dó na corda Lá, casa 3; C/E → Mi solto), na
  corda Mi ou Lá, na casa mais baixa (`bassFret` no `chords.js`).
- **Cartão "Violão/Cavaco/Teclado agora"** muda no máximo uma vez por tempo (junta as notas do tempo, uma por
  corda); antes trocava a cada semicolcheia. O baixo segue nota a nota.

- **Pista do braço (Modo Show e "Tocando agora").** O que o usuário quer, depois de reprovar várias versões
  (nota por nota com número: "muita coisa"; cartão com diagrama: "quadrado grande"; faixas de corda no jeito do
  Guitar Hero: "não precisa imitar, quero o desenho no braço"; braços pequenos crescendo em perspectiva: "nada
  desse efeito de zoom"; descendo de cima: "nada de cima para baixo, as notas vêm chegando da direita para a
  esquerda"): **o braço real e as bolinhas de cada acorde (com a pestana) entrando pela direita e andando para
  a esquerda até a casa certa na hora de tocar.** Braço: 12 casas à vista (9 no celular; "tá muito comprido"),
  espaçamento real, nome das cordas com a mais grave em cima, soltas = anel e não toca = × antes da pestana do
  braço (só no acorde de agora), número das casas embaixo. As bolinhas que vêm são brancas (cinza sem cor da
  música), andam em velocidade constante (dois compassos para atravessar o braço) com o nome do acorde em
  cima; o acorde de agora fica na cor da música enquanto soa. Acorde fora das casas à vista anda com as casas
  dele. Formação = a mesma do cartão "Como tocar" (`shapeFor` no `chords.js`). Teclado: o mesmo com um
  teclado. As pistas usam sempre a lista **detalhada** de acordes (no Simples o show mostrava bem menos); o
  microfone confere a lista que está na tela (Pista: detalhada; Partitura: a do nível); a Voz e o jogo de
  melodia no show usam a melodia detalhada.
  - **Modo Show**: botões "Pista | Partitura" (guardado, `pv.showView`; padrão Pista); Violão/Cavaco/Baixo/
    Teclado/Voz em cima (Voz = melodia caindo sobre teclas). Com o jogo valendo pontos: indicadores do Guitar
    Hero em cima (pontos, multiplicador até x4 com anel, acertos seguidos, medidor da plateia); acerto do
    microfone solta raios do desenho no braço. Na pista o quadro "Agora/Depois/1-2-3-4" some.
  - **"Tocando agora"**: o mesmo braço, mais baixo, no lugar dos quadros "Acorde agora / Próximo".
- **Pista: cada batida do instrumento.** O usuário: "não é possível que o violão seja só essas notas"
  (o violão faz ~13 batidas por compasso e a pista mostrava 1 desenho por acorde). Agora cada batida da
  gravação (as notas transcritas do instrumento) entra pela direita até a casa; a posição de cada nota vem
  do desenho do acorde daquele momento (`attackPositions`: a nota exata na corda da formação; senão a nota
  de verdade perto da região do acorde). O desenho do acorde de agora fica apagado, de referência. Só ~1
  compasso na tela.
- **Acordes que faltavam (passagens).** Na Um vencedor o F#m ocupava ~8 compassos: a cifra colada começa no
  verso e o encaixe esticava ela sobre a introdução; e o próprio reconhecimento confundia A7M/A6 com
  F#m7(11) (quase as mesmas notas). Duas correções:
  - `align_cifra` ganhou o estado "fora da cifra" (`OFF_CIFRA`): trecho que a cifra não traz fica com o acorde
    ouvido (desvantagem `off_margin`=2,5 por tempo, para a cifra simplificada continuar valendo).
  - **Gravação de referência** (`app/referencia.py`, menu ⋯ → "Ensinar os acordes com uma gravação minha",
    `POST /api/songs/{sid}/referencia`): a pessoa manda um áudio dela tocando (o m4a do celular serve); o app
    alinha com a harmonia da música (croma + DTW com inclinação entre 1/2 e 2), reconhece os acordes e as notas
    da gravação dela e usa esses acordes no trecho coberto (`work/referencia.json`; vale para a mesma grade de
    tempos; reanálise que muda a grade pede para mandar de novo). Aplicado na Um vencedor com a gravação do
    usuário (tempos 12 a 121): saem o F#m comprido e entram F7M, Dm7, C7M, Am, Bm7(b5), C#m7(b5)...
- **Cartão "Como tocar" virou "Próximo"**, pequeno (nome + diagrama miniatura): o de agora já está no braço
  grande de "Tocando agora", que ficou mais alto. Saiu o cartão "Violão agora" (notas ao vivo).
- **Modo Show com o braço em pé** ("no modo ao vivo o braço voltou a ser horizontal"): o mesmo braço do
  "Tocando agora", girado 90° (`ctx.transform` + `txt` para os textos ficarem em pé): pestana do braço
  embaixo, casas subindo, Mi grave à esquerda; o próximo acorde desce de cima até a casa certa. O "Tocando
  agora" continua deitado, com o acorde vindo da direita. Sem as marcações cinza do braço (pareciam notas).
- **Teclado na pista: as teclas do próximo acorde caem de cima** até o teclado na hora de tocar (pedido do
  usuário: "pra teclado as notas precisam vir de cima pra baixo, não tem jeito").
- **Cavaco caía dentro do "violão".** O separador de 6 partes não tem cavaco: na Estonteante a parte "outros"
  ficou quase em silêncio e 48% das notas do "violão" estavam acima do Sol4. `violao.split_high_strings` divide
  as notas da parte "violão": acima do Lá#4, ou batida só na região aguda (Ré4+, 3+ notas, sem grave junto) →
  cavaco (somado ao que vier de "outros"); o resto → violão. Na análise (`pipeline.analyze`) e refeito nas 3
  músicas por script, sem reprocessar.
- **Revisão independente** (workflow com 37 agentes, 30 achados confirmados, todos tratados menos 1): cartão
  que sumia antes da hora, cartão maior que a pista em tela baixa, sus2 fora do diagrama, teclas marcadas
  invisíveis, pestana passando por corda que não toca (Fmaj7; corrigido em `fingering`, vale para o cartão do
  braço também), barra de cima do show no celular escondendo o X no jogo, marcas do "Tocar de novo", chip de
  acorde aceso em dobro, preferência Pista gravada errada, partitura redesenhada invisível atrás do show,
  esteira: pausa de vários compassos travando (multirest desligado + pedaço que falha não repete), emenda entre
  pedaços sem pulo, nota longa no cartão "Teclado agora". Ficou de fora: cada pedaço da esteira ainda passa pela
  formatação do OSMD da música toda (medido: 1 compasso ~56 ms, 8 ~0,8 s no violão cheio; a Pista não usa isso).

Próximos passos (nesta ordem):
0. O usuário testar a pista no celular de verdade e no PC fraco (i5-3470) e dizer se a velocidade e a quantidade
   de notas (batida de violão em semicolcheias) estão boas de ler.
1. **Gabarito com 10 a 15 músicas** (o usuário manda MP3 + cifra do Cifra Club; guardar só os acordes, mais compasso e BPM). Só com isso dá para melhorar acordes e compasso sem remendo. Marcar no gabarito se a cifra é simplificada ou completa (a prova "completo" só vale para as completas). "Não Vou Entregar" (Belo) está no app sem cifra: o usuário toca e vai conferir de ouvido.
2. Compasso: tornar `estimate_meter` estável e medir contra o gabarito; acordes que trocam no meio do tempo quando o tempo é lento.
3. Baixo: usar o baixo transcrito para inversões que a gravação mostra (validar no gabarito).
4. Testar no notebook com placa de vídeo (separação máxima, letra `large-v3`) e o instalador numa máquina limpa.
6. Testar "Corrigir letra" e o Modo Show valendo pontos com microfone real.
7. **Segunda parte do sistema (separada deste app):** aplicação web de **teoria musical** completa e intuitiva, **mais gráfica do que escrita**, com **apresentações**, **provas** e **questões**. Pedido do usuário em 14/10/2026.
8. **Login** (conta da pessoa), junto com a parte web.
9. Por último: rede social (decisão do usuário).
10. Nome: o usuário não gostou de "soundStudy" (14/10/2026); está escolhendo outro. O repositório pode ser renomeado no GitHub sem perder nada.
