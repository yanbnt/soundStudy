"""Gera as imagens e os textos do instalador (rode antes de compilar o PautaViva.iss).

    .venv\\Scripts\\python.exe instalador\\gerar.py

- imagens/lateral-*.bmp: faixa da esquerda das telas de boas-vindas e de conclusão (preta, com a marca);
- imagens/icone-*.bmp: a marca no canto de cima das outras telas (fundo transparente);
- sobre.rtf: para que serve o programa, internet e requisitos mínimos;
- termo.rtf: termo de uso e responsabilidade (o instalador só segue se a pessoa aceitar).

O nome do programa fica em NOME (o mesmo #define AppName do PautaViva.iss).
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

NOME = ("Pauta", "Viva")  # parte em negrito e parte em itálico, como na logo do app
AQUI = Path(__file__).resolve().parent
LOGO = AQUI.parent / "docs" / "img" / "logo.png"
ESCALAS = (100, 125, 150, 175, 200)


# ---------------------------------------------------------------- imagens

def _marca(lado):
    """Quadrado branco de cantos redondos com a marca preta (como no topo do app), fundo transparente."""
    big = lado * 4
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.24), fill=(255, 255, 255, 255))
    logo = Image.open(LOGO).convert("RGBA").resize((int(big * 0.86), int(big * 0.86)), Image.LANCZOS)
    # o desenho é preto num fundo branco: o que é escuro vira tinta (e respeita a transparência, se houver)
    mask = ImageChops.multiply(ImageOps.invert(logo.convert("L")), logo.getchannel("A"))
    tinta = Image.new("RGBA", logo.size, (0, 0, 0, 255))
    tinta.putalpha(mask)
    off = (big - logo.width) // 2
    img.alpha_composite(tinta, (off, off))
    return img.resize((lado, lado), Image.LANCZOS)


def _fonte(nome, tamanho):
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / nome), tamanho)


def lateral(escala):
    w, h = round(164 * escala / 100), round(314 * escala / 100)
    k = escala / 100
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    # pauta que vira onda, bem apagada, no pé da faixa
    import math
    for i in range(5):
        y0 = h * 0.80 + i * 7 * k
        pts = []
        for x in range(0, w + 1, 2):
            u = x / w
            amp = 5 * k * max(0.0, u - 0.25) / 0.75
            pts.append((x, y0 + amp * math.sin(2 * math.pi * (u * 1.6 - 0.1))))
        d.line(pts, fill=(255, 255, 255, 46), width=max(1, round(1.2 * k)))
    # a marca e o nome
    lado = round(72 * k)
    m = _marca(lado)
    img.alpha_composite(m, ((w - lado) // 2, round(h * 0.25)))
    f1, f2 = _fonte("georgiab.ttf", round(23 * k)), _fonte("georgiai.ttf", round(23 * k))
    t1, t2 = NOME[0] + " ", NOME[1]
    w1, w2 = d.textlength(t1, font=f1), d.textlength(t2, font=f2)
    x = (w - (w1 + w2)) / 2
    y = round(h * 0.25) + lado + round(16 * k)
    d.text((x, y), t1, font=f1, fill=(255, 255, 255, 255))
    d.text((x + w1, y), t2, font=f2, fill=(255, 255, 255, 255))
    return img


def gerar_imagens():
    pasta = AQUI / "imagens"
    pasta.mkdir(exist_ok=True)
    for esc in ESCALAS:
        lateral(esc).save(pasta / f"lateral-{esc}.bmp")
        _marca(round(55 * esc / 100)).save(pasta / f"icone-{esc}.bmp")


# ---------------------------------------------------------------- textos (RTF)

def _rtf_escape(s):
    out = []
    for ch in s:
        if ch in "\\{}":
            out.append("\\" + ch)
        elif ord(ch) < 128:
            out.append(ch)
        else:
            code = ord(ch)
            out.append(f"\\u{code if code < 32768 else code - 65536}?")
    return "".join(out)


def rtf(blocos):
    """blocos: lista de (tipo, texto) com tipo em titulo, secao, par, item, nota."""
    partes = [r"{\rtf1\ansi\deff0{\fonttbl{\f0\fnil\fcharset0 Segoe UI;}}\viewkind4\uc1"]
    for tipo, texto in blocos:
        t = _rtf_escape(texto)
        if tipo == "titulo":
            partes.append(r"\pard\sa60\b\fs26 " + t + r"\b0\fs19\par")
        elif tipo == "secao":
            partes.append(r"\pard\sb160\sa40\b\fs20 " + t + r"\b0\fs19\par")
        elif tipo == "item":
            partes.append(r"\pard\fi-220\li220\sa30\fs19 \u8226? " + t + r"\par")
        elif tipo == "nota":
            partes.append(r"\pard\sb80\sa60\i\fs18 " + t + r"\i0\fs19\par")
        else:
            partes.append(r"\pard\sa80\fs19 " + t + r"\par")
    partes.append("}")
    return "\n".join(partes)


APP = " ".join(NOME)

SOBRE = [
    ("titulo", f"{APP}: partitura, cifra, letra e tablatura da música que você quer aprender"),
    ("secao", "Para que serve"),
    ("par", f"O {APP} é uma ferramenta 100% didática, feita para quem está aprendendo música. Você escolhe "
            "uma gravação e ele escreve a partitura, a cifra, a letra e a tablatura do violão, que andam junto "
            "com o som. O objetivo é um só: ajudar você a estudar e a aprender a ler música tocando."),
    ("secao", "O que ele faz"),
    ("item", "Separa a gravação em voz, violão, teclado, cavaco, baixo e percussão."),
    ("item", "Acha o andamento, o compasso, o tom e os acordes."),
    ("item", "Escreve a melodia na pauta e o violão nota por nota, com tablatura."),
    ("item", "Encaixa a letra embaixo das notas, sílaba por sílaba."),
    ("item", "Mesa de som com equalizador, Modo palco e Modo Show."),
    ("secao", "Tudo roda no seu computador"),
    ("par", f"O processamento acontece na sua máquina. Suas gravações não são enviadas para servidores do {APP}."),
    ("secao", "Precisa de internet"),
    ("item", "Para instalar (uma vez): baixa o Python e os componentes de inteligência artificial, cerca de "
             "1,5 GB sem placa de vídeo NVIDIA ou 4 GB com placa NVIDIA."),
    ("item", "No primeiro uso: baixa os modelos de separação e de reconhecimento de letra, uma vez só (até 4 GB)."),
    ("item", "Para buscar a letra e a capa de cada música. Só o nome do artista e da música é enviado."),
    ("par", "Depois de instalado, sem internet o programa continua transcrevendo: a letra vem do "
            "reconhecimento da voz e a cor da tela vem do tom da música."),
    ("secao", "Requisitos mínimos"),
    ("item", "Windows 10 ou 11, 64 bits."),
    ("item", "Processador de 4 núcleos (Intel Core i5 de 3ª geração, AMD Ryzen 3 ou superior)."),
    ("item", "8 GB de memória RAM (16 GB recomendado)."),
    ("item", "10 GB livres no disco (15 GB com placa de vídeo NVIDIA)."),
    ("item", "Google Chrome ou Microsoft Edge atualizado."),
    ("item", "Fones de ouvido ou caixas de som. Microfone é opcional (Modo Show valendo pontos)."),
    ("secao", "Recomendado para a qualidade máxima"),
    ("item", "Placa de vídeo NVIDIA com 6 GB de memória ou mais (GeForce GTX 1660, RTX 2060 ou superior), "
             "com o driver atualizado."),
    ("item", "Com ela, cada música fica pronta em 1 a 2 minutos, com a melhor separação dos instrumentos e a "
             "letra reconhecida com mais precisão. Sem ela, o tempo é de 3 a 4 vezes a duração da música."),
]

TERMO = [
    ("titulo", f"Termo de uso e responsabilidade: {APP}"),
    ("nota", "Versão de teste 0.1, 14 de outubro de 2026. Para instalar e usar o programa, você precisa "
             "aceitar este termo."),
    ("secao", "1. Finalidade 100% didática"),
    ("par", f"O {APP} é uma ferramenta de estudo de música, feita exclusivamente para fins didáticos: aprender "
            "a ler partitura, cifra e tablatura acompanhando gravações, em uso pessoal e privado. Ele não é um "
            "serviço de distribuição de músicas, partituras ou letras."),
    ("secao", "2. Seus arquivos de áudio"),
    ("par", "Você é o único responsável pelas gravações que usa no programa e deve ter o direito de usá-las "
            "(por exemplo, músicas que você comprou, gravou ou que tem licença para usar dessa forma)."),
    ("secao", "3. Transcrições geradas automaticamente"),
    ("par", "As partituras, cifras, letras e tablaturas são geradas por algoritmos e por inteligência "
            "artificial e podem conter erros. Elas servem de apoio ao estudo e não são edições oficiais "
            "das obras."),
    ("secao", "4. Direitos autorais e divulgação"),
    ("par", f"As obras musicais (melodia, harmonia e letra) e as gravações pertencem aos seus autores, editoras "
            f"e gravadoras. O material gerado pelo {APP} destina-se apenas ao seu estudo pessoal. É proibido "
            "publicar, compartilhar, distribuir, vender ou exibir publicamente as partituras, cifras, letras e "
            "tablaturas geradas sem a autorização de quem detém os direitos."),
    ("par", f"Os desenvolvedores do {APP} não se responsabilizam pela divulgação não autorizada das partituras "
            "e dos demais materiais gerados, nem por qualquer uso que viole direitos de terceiros. Essa "
            "responsabilidade é inteiramente de quem fizer a divulgação ou o uso indevido."),
    ("secao", "5. Letras e capas da internet"),
    ("par", "Para mostrar a letra e a capa, o programa consulta bases públicas na internet (como a LRCLIB e a "
            "loja do iTunes), enviando apenas o nome do artista e da música. Letras e capas pertencem aos seus "
            "titulares e são exibidas somente para estudo."),
    ("secao", "6. Privacidade"),
    ("par", f"O processamento das músicas acontece no seu computador. Suas gravações e transcrições não são "
            f"enviadas para servidores do {APP}."),
    ("secao", "7. Componentes de terceiros"),
    ("par", "O programa usa bibliotecas e modelos de código aberto, cada um com a sua licença (lista no arquivo "
            "AVISOS DE TERCEIROS, na pasta do programa). O modelo da separação máxima é usado apenas em "
            "caráter de teste e de uso pessoal."),
    ("secao", "8. Versão de teste e ausência de garantia"),
    ("par", "Esta é uma versão de teste. O programa é fornecido no estado em que se encontra, sem garantia de "
            "funcionamento, de exatidão das transcrições ou de adequação a uma finalidade específica. Os "
            "desenvolvedores não respondem por perdas ou danos decorrentes do uso ou da impossibilidade de uso "
            "do programa."),
    ("secao", "9. Aceite"),
    ("par", "Ao marcar \"Eu aceito o termo\" e continuar a instalação, você declara que leu, entendeu e "
            "concorda com este termo."),
]


def gerar_textos():
    (AQUI / "sobre.rtf").write_text(rtf(SOBRE), encoding="ascii")
    (AQUI / "termo.rtf").write_text(rtf(TERMO), encoding="ascii")


if __name__ == "__main__":
    gerar_imagens()
    gerar_textos()
    print("ok: imagens/, sobre.rtf, termo.rtf")
