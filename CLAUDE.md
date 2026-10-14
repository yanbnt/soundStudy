# Instruções para o Claude neste projeto

- Leia `PROJETO.md` antes de mexer em qualquer coisa: visão, arquitetura, decisões, estado atual e próximos passos.
- Responda em português, curto e direto. O usuário prefere ver o resultado (prints, telas) a ler textão.
- Nunca escreva letra de música em respostas, código ou documentos (direito autoral). Teste a letra só com números ou frases inventadas.
- Identidade visual própria: não copie Spotify nem outros produtos. O tema é preto e branco (preto puro, sem bordas, branco nos destaques); não reintroduza cores.
- O computador do usuário é fraco (i5-3470, Intel HD): nada de blur ou filtros pesados; animação em canvas a 30 fps.
- Servidor: `.venv\Scripts\python.exe -m uvicorn app.server:app --host 127.0.0.1 --port 8765`. Reinicie depois de mudar Python.
- Scripts de teste vão em `%TEMP%` (caminhos longos quebram o Python no Windows).
- Ao terminar uma etapa, atualize a seção "Estado atual" do `PROJETO.md`.
