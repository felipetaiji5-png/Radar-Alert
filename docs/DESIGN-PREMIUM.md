# Horizonte — direção visual aeroespacial

Redesign local de 09/11/2026. Versão permanece 0.18.0; sem publicação.

## Referência e adaptação

Referência principal: documento fornecido `flight-details-claude-code.md`, lido integralmente. Foram adaptados a paleta escura, superfícies de vidro, bordas luminosas discretas, dock flutuante e movimento amortecido. Não foram adotados recursos de voos, globo 3D, reservas, aeroportos ou novos indicadores sem dados.

O Radar Alert mantém seus quatro destinos: Painel, Mapa, Diagnóstico e Radares. O painel agora apresenta o mapa real junto dos instrumentos. `ui/cockpit-layout.js` reposiciona o mesmo contêiner Leaflet; não duplica mapas, listeners de GPS nem regras de alertas. `ui/map-view.js` recalcula o tamanho imediatamente ao trocar de área, evitando um frame com geometria antiga. Consulta técnica: [Leaflet 1.9.4, invalidateSize](https://leafletjs.com/reference-1.9.4.html#map-invalidatesize), via Context7.

## Sistema visual

- Fundo #05070E, superfícies #0F172A, texto #E2E8F0, secundário #94A3B8 e ciano #38BDF8.
- Verde para via confirmada, âmbar para referência/atenção e borda rosa/vermelha na placa de limite. A cor sempre acompanha um texto de estado.
- Tipografia Inter quando disponível, com fallback de sistema; nenhuma fonte remota adicionada. Números tabulares nos instrumentos.
- Superfícies de 18–32 px de raio, espaçamento de 4/8 px e controles de toque de pelo menos 44 px nas ações principais.
- Blur limitado a navegação e botões do mapa, com fallback opaco. Sem blur sobre o mapa inteiro. Tiles OSM recebem somente tratamento cromático CSS; marcadores e atribuição continuam separados.
- Em retrato, mapa acima dos instrumentos; em paisagem, mapa ao lado. Dados secundários e ilustração seguem acessíveis por rolagem. A PWA aceita qualquer orientação; antes seu manifesto travava retrato.

## Movimento

- Entrada de superfícies: opacity + translateY, 220–260 ms.
- Diálogos: entrada de 360 ms com curva cubic-bezier amortecida; saída de 140 ms com transição discreta de display nos navegadores compatíveis (fechamento imediato como fallback).
- Pressionar controles: escala .96 durante 160 ms.
- Alteração numérica: leitura atual aplicada imediatamente; apenas a opacidade recebe transição de 180 ms. Sem contagem interpolada que pudesse inventar velocidade/distância.
- Expansão de detalhes: entrada de 220 ms. A ilustração preserva sua transição orientada pela distância recebida, sem aproximação autônoma.
- `prefers-reduced-motion` desativa transições, keyframes e animações numéricas, inclusive ao alterar a preferência durante a sessão.
- Sem loops decorativos, animação contínua de brilho ou biblioteca de animação nova.

## Escopo e invariantes

33 arquivos protegidos comparados byte a byte com os fontes anteriores: `core.js`, lockfile, `geo/`, `sim/` e `android-template/`. Nenhuma diferença. Em `app.js`, somente import e composição visual foram alterados. Configurações persistidas e APIs de dados permanecem iguais. Não há novas dependências e a versão não mudou.

Veja `outputs/redesign-premium/RELATORIO.md` e `comparacao.html` no workspace para resultados desta revisão. Arquivos de evidência ficam fora dos fontes distribuídos.
