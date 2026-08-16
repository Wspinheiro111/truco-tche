# Validação visual de jogabilidade

- A mesa local exibiu três cartas completas na mão do jogador em viewport desktop durante a partida de validação.
- A renderização controlada da mesa on-line exibiu uma carta de cada jogador e o rótulo “Você ganhou a vaza”.
- A retenção visual da vaza on-line permanece ativa por 1,85 segundo antes de liberar a próxima leitura de mesa.
- Em um contêiner de 375 px, a mão on-line mediu 354 px e as três cartas ficaram inteiramente dentro dela, com larguras de 82 px e sem overflow.
- Em 1280 px, a mão mediu 480 px e as três cartas ocuparam os intervalos horizontais 509–591 px, 599–681 px e 689–771 px, todos dentro do contêiner 400–880 px; as duas cartas da vaza também ficaram dentro de suas áreas de mesa.
- A inspeção geométrica repetida no desktop confirmou deslocamentos negativos de overflow à esquerda, à direita e abaixo para as três cartas, isto é, nenhuma ultrapassou o contêiner da mão.
- A asserção direta estabilizada em 1280 px retornou `handAllInside: true` para as três cartas da mão; a vaza ativa também havia retornado uma carta contida em cada área de mesa e o indicador de vencedor visível.
