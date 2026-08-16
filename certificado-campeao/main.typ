#import "report-theme.typ": report-accent

#let couro = rgb("#32180c")
#let erva = rgb("#0f4829")
#let ouro = rgb("#d6ad4b")
#let pergaminho = rgb("#f8efd8")
#let campo = rgb("#fffaf0")

#set page(
  width: 297mm,
  height: 210mm,
  margin: (x: 17mm, y: 14mm),
  fill: pergaminho,
  numbering: none,
  background: [
    #place(center, rect(width: 287mm, height: 200mm, radius: 3mm, stroke: 2.1pt + couro))
    #place(center, rect(width: 280mm, height: 193mm, radius: 2mm, stroke: 0.8pt + ouro))
  ],
)
#set text(font: "DejaVu Serif", fill: couro, lang: "pt")
#set par(first-line-indent: 0pt, leading: 1.12em)

#align(center)[
  #v(3mm)
  #text(size: 12pt, weight: "bold", fill: erva, tracking: 1.2pt)[TRUCO TCHÊ]
  #v(2mm)
  #text(size: 27pt, weight: "bold", fill: ouro, stroke: 0.35pt + couro)[CERTIFICADO DE CAMPEÃO]
  #v(1.5mm)
  #text(size: 10pt, fill: erva, weight: "bold")[TORNEIO MANO A MANO · 1 CONTRA 1]
  #v(7mm)
  #text(size: 12pt)[Certificamos, para honra da cancha e memória do pago, que]
  #v(3mm)
  #block(
    width: 220mm,
    inset: (top: 4mm, bottom: 5mm, x: 9mm),
    radius: 2mm,
    fill: campo,
    stroke: 0.75pt + ouro,
  )[
    #text(size: 24pt, weight: "bold", fill: couro)[NOME DO CAMPEÃO]
  ]
  #v(3.5mm)
  #text(size: 12pt)[
    mostrou firmeza de pulso, respeito pelos viventes e boa mão nas cartas,
    conquistando o título de campeão do torneio
  ]
  #v(2.5mm)
  #text(size: 18pt, weight: "bold", fill: erva)[NOME DO TORNEIO]
  #v(4mm)
  #text(size: 11pt)[
    Que este feito fique registrado: na disputa mano a mano, venceu com coragem,
    parceria de respeito e alma de gaúcho. A cancha reconhece teu mérito, tchê!
  ]
  #v(8mm)
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 20mm,
    align(center)[
      #line(length: 76mm, stroke: 0.65pt + couro) \
      #text(size: 8pt)[Data e local do torneio]
    ],
    align(center)[
      #line(length: 76mm, stroke: 0.65pt + couro) \
      #text(size: 8pt)[Assinatura da organização]
    ],
  )
  #v(4mm)
  #text(size: 8pt, fill: erva, weight: "bold")[Truco Tchê · Onde a tradição encontra a cancha digital]
]
