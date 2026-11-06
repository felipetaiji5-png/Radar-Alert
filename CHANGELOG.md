## 0.17.2 — Validação e continuidade do GPS

- Corrige a rejeição de leituras atuais como gpsStale quando o relógio do GPS difere do relógio do celular. Idade e ordem das posições Android usam elapsedRealtimeNanos, inclusive durante suspensão.
- A ponte Android converte a idade para o painel no recebimento; broadcasts atrasados continuam antigos e não viram posições novas.
- Renova automaticamente a solicitação GPS após 45 s sem posição válida, com intervalo entre tentativas. Falhas temporárias de registro não anunciam mais que o serviço parou.
- Preserva START_STICKY ao atualizar a base/malha, permitindo ao Android recriar o serviço quando aplicável. A parada manual continua respeitada.
- Diagnóstico registra idade monotônica de fixes recusados e diferença relevante entre relógios, sem coordenadas.
- 200 testes Node (incluindo 26 verificações Java de idade/recuperação), 25 grupos de navegador e build APK aprovados. Execução com GPS físico e tela bloqueada permanece pendente.

## 0.17.1 — GPS com o veículo parado

- Remove o deslocamento mínimo de 5 m exigido pelo serviço Android no perfil STOPPED, mantendo o intervalo solicitado de 6 segundos.
- Evita que o próprio filtro de movimento interrompa novas leituras e faça o painel indicar GPS desatualizado. A entrega efetiva continua dependente do GPS e do Android.
- Mantém o rumo desconhecido quando parado e a distância em linha reta como referência, sem liberar alertas de rota sem confirmação.
- Adiciona regressão com três minutos de posições estacionárias, expiração após perda de leituras e recuperação.

## 0.17.0 — Horizonte

- Interface redesenhada com azul profundo, painel claro e detalhes em laranja.
- Ilustração 2D integrada aos instrumentos, com cenário vetorial e régua proporcional.
- Navegação flutuante, ícones revisados e placas de limite na lista de radares.
- Alto contraste com instrumentos escuros e ajustes reorganizados.
- Referências de produtos reais: CarPlay, Rivian, Polestar, Mapbox e Waze; fontes documentadas.
- 198 testes Node e 24 grupos de navegador aprovados. APK compilado; GPS físico e tela bloqueada permanecem pendentes.

## 0.16.2

- Rejeição de GPS antigo/futuro antes de alertar, no painel e no serviço Android.
- Cancelamento de consultas e isolamento de eventos de sessões encerradas.
- Recuperação correta de erros GPS e indicação de falha ao parar o serviço.
- Limpeza de dados sem download automático imediato, com restauração das preferências e cancelamento de início pendente.
- Correção da suspensão/reabertura da página e ocultação de valores sem GPS válido.
- 198 testes Node, 23 grupos de navegador e compilação APK aprovados. GPS físico e execução com tela bloqueada ainda pendentes.

## 0.16.1

- Nova ilustração 2D de carro, rua e radar vinculada à distância do painel.
- Escala de 0–1 km, movimento conforme GPS e diferenciação entre distância pela via e em linha reta.
- Oculta radar com GPS inválido e respeita movimento reduzido.
- Corrigida mensagem persistente de GPS impreciso após recuperação.
- 186 testes Node, 13 grupos de navegador e compilação APK aprovados; validação física pendente.

## 0.16.0

Interface redesenhada com tema escuro e verde-lima; novos painéis, navegação desktop, modais acessíveis e ícone Android. 172 testes Node, 12 grupos de testes de navegador, 28 combinações de layout e compilação APK debug aprovados. Validação física no aparelho pendente.

## 0.15.3

- Corrigido o painel que ocultava limite e distância sem radar confirmado pela malha OSM.
- Exibe o radar ativo mais próximo como referência, com distância em linha reta e limite cadastrado, inclusive parado.
- Referências não emitem alertas; distância pela via tem prioridade quando há radar de rota confirmado.
- Limpa valores com GPS inválido/desatualizado ou monitoramento desligado.
- 172 testes e build web aprovados; APK e validação em aparelho pendentes.

## 0.15.2

Inicialização da base sem bloqueio pelo catálogo, recuperação de respostas Overpass incompletas, preferências validadas e mensagens corretas de persistência. Restaurado stub Java ausente e adicionado lockfile. 153 testes e build web aprovados. APK e testes em aparelho pendentes.

# Changelog

## 0.15.1 — Hotfix de migração e continuidade do GPS nativo

- Corrigido crash lógico do início do serviço Android ao encontrar `road-network-background.json` de versão antiga ou incompatível. A malha inválida é rejeitada, a cobertura é marcada como indisponível e os alertas de rota permanecem suspensos, porém o GPS nativo continua ativo.
- Um snapshot candidato inválido do cache regional não limpa a última malha ativa validada.
- `roadNetworkIssue` exposto no status nativo e zerado após carregar uma malha válida.
- Escritas de catálogo/malha serializadas na ponte Web; payload dos radares ordenado de forma estável, inclusive em caso de IDs duplicados.
- Nova classe Java de política de revisão incluída na instalação e na verificação Android. Corrigido identificador de cache no `postbuild.mjs` (não fica mais preso à v0.15.0).
- **137 testes aprovados**, incluindo 5 testes adicionais e sete verificações executadas pelo JDK de revisões de snapshot. `npm run check` aprovado. Sem APK compilado nesta sessão.


## 0.15.0 — Cache regional Android, integridade de catálogo e inicialização offline

- Serviço Android seleciona automaticamente uma dentre até 12 malhas OSM já sincronizadas, sem consultar a rede no segundo plano. Seleção baseada na margem real de cobertura e geodesia; ausência de região adequada continua suspendendo os alertas.
- `cacheRoadNetwork()` sincroniza geometrias de pré-carregamento sem substituir a região ativa; ação **Preparar área do mapa** permite preparar a região central do mapa, com requisitos de GPS e consulta OSM explícitos.
- Cada snapshot regional usa revisão de catálogo SHA-256 no nome e no payload. A malha é recusada se a base de radares for diferente, evitando associação de um radar a geometria antiga após atualizações.
- Arquivos nativos salvos por `AtomicFile`; leitura/reload do catálogo e malha sob lock com avaliações de GPS; o novo grafo é construído e validado antes da troca. Reuso sem gravações/reloads redundantes quando os dados não mudam.
- Leaflet JS/CSS distribuídos dentro do aplicativo pelo Vite, sem `unpkg` no runtime. Tiles de fundo ainda requerem rede/cache.
- Histórico de estabilidade: uma única troca passa a ser descrita como mudança pontual, não como oscilação persistente.
- Indicador das regiões sincronizadas no Diagnóstico e no texto copiado; verificador `npm run android:verify` para detectar instalação com arquivos antigos.
- 132 testes automatizados aprovados, incluindo testes Java com `javac` para seleção e armazenamento regional (stubs apenas para dependências Android/JSON), e `npm run check` aprovado. Layout estático validado em 320, 390, 430, 1280 px sem overflow horizontal.
- **Não validado:** build Android completo/Gradle, comportamento físico no S23 com tela bloqueada, alertas reais em deslocamento, cobertura de todo o Estado. Não é correto chamar a versão de produção definitiva sem estes testes.

## 0.14.0 — Interface sóbria, diagnóstico estacionário e estabilidade da via

- Nova camada de identidade visual `refined.css`: superfícies grafite sem gradientes decorativos, tipografia mais consistente, ações primárias claras e navegação mobile limpa. Dados secundários do Painel ficam recolhidos em “Detalhes da sessão”.
- Diagnóstico de veículo parado: quando o GPS informa velocidade até 3 km/h e o Map Matching não obtém rumo confiável (`NO_HEADING`), apresenta “Aguardando movimento” e “Rua próxima”, **sem confirmar a via e sem liberar alertas por rota**.
- Histórico temporário de estabilidade `geo/road-stability.js`: acompanha os últimos 3 minutos de nomes de ruas candidatas, registra mudanças e informa a duração da sequência atual; não armazena coordenadas, probabilidades nem percurso e reinicia a cada sessão.
- Círculo de precisão GPS existente agora tem legenda, valor estimado visível e botão para mostrar/ocultar. O mapa deixa de exibir o círculo e marcador anteriores como atuais após perda ou rejeição de fix, parada do monitoramento e envelhecimento da posição.
- Mensagens de diagnóstico repetidas são reduzidas; mudanças de decisão próximas não inundam o histórico. A cópia de diagnóstico inclui o resumo de estabilidade sem coordenadas.
- 11 novos testes; **123/123 testes JavaScript aprovados**. Layout estático conferido nas larguras de 320, 390, 430 e 1280 px, sem rolagem horizontal.
- Não há alteração nos critérios de associação de radares nem no serviço Android. A nova versão ainda precisa de compilação no Android Studio e validação em dispositivo.

## 0.13.0 — Shell mobile, módulos de interface e laboratório offline

- Redesign de navegação em quatro telas no celular (Painel, Mapa, Diagnóstico, Radares); preserva GPS em segundo plano quando o usuário alterna as telas.
- Visão de direção com velocidade GPS destacada, texto legível, contraste reforçado configurável e mapa maior.
- Modo direção exclusivamente visual com entrada/saída por leituras consecutivas para evitar oscilação.
- Extração de componentes `ui/`: navegação, MapView, lista, diagnóstico, integridade, controles do simulador e modo direção. Motores `geo/` permanecem estáveis.
- Laboratório isolado (`sim/`) com trajetória fictícia e cenários de via única, vias paralelas e parada; nunca aciona GPS real, Android ou alertas de produção.
- 14 testes novos; 112 testes JavaScript aprovados. Verificação estática mobile 320–1280 px, sem rolagem horizontal; APK não compilado aqui.
- Preservadas as limitações de cobertura OSM e monitoramento em segundo plano já documentadas.


## 0.12.0 — Auditoria GPS, índice espacial e cache resiliente

- Rumo GPS mais robusto (Web + Android) contra jitter, posição antiga, lacunas e velocidade inferida sem suporte estatístico.
- Reinicialização do rumo a cada fix nativo; sem reaproveitamento de bearing antigo em segundo plano.
- SpatialIndex de trechos por células da geometria, com deduplicação e suporte a segmentos longos; busca local menos custosa.
- Malha OSM de cache com mais de 30 dias volta imediatamente sem travar tela, com aviso explícito de desatualização e atualização manual preservada.
- Visualização opcional e temporária dos últimos 50 pontos GPS no mapa, sem persistência.
- 11 testes novos e suite 97/97 passando. Compilação Android ainda pendente.

## 0.11.0 — Cockpit mobile e ruas candidatas

- Moderniza o tema visual, cabeçalho compacto, estados de GPS, botões, cores, navegação inferior e modais com foco no uso com uma mão.
- Lista até quatro vias distintas candidatas no diagnóstico, agrupando trechos pelo identificador OSM e camada, com distância lateral; não usa esses dados para liberar alertas.
- Informa que o contador mostra trechos, e não ruas diferentes.
- Acrescenta visualização das vias alternativas em lilás tracejado, centralização/retomada de acompanhamento e expansão do mapa.
- Limita a renderização de até 120 marcadores de radar por lote no mapa (refresca a cada 12 s ou 65 m); mantém o ponto GPS e via atualizados.
- Separa atualização de radares Pardal e atualização forçada OSM, evitando consultas demoradas involuntárias.
- Mantém serviço Android nativo, rede viária e regras de alerta da 0.10.0; inclui testes de regressão.


## 0.10.0 — Diagnóstico de via e experiência mobile

- Exibe via confirmada/candidata, afastamento GPS-via, desvio de direção, rumo e quantidade de segmentos viários considerados.
- Expõe o motivo da rejeição quando a via não é confiável, inclusive ambiguidade ou ausência de rumo. Não cria porcentagem artificial de confiança.
- No mapa, a via candidata é âmbar e tracejada; a via confirmada é azul, com círculo aproximado da precisão GPS.
- Ajusta exibição e cópia do painel de diagnóstico, sem incluir coordenadas de GPS nos logs.
- Reformula layout em telas pequenas: tipografia maior, alvos de toque de 44 px ou mais, navegação inferior acessível, cards responsivos, controles principais em destaque, detalhes do equipamento recolhíveis, mapa ampliado e modais estilo bottom sheet.
- Adiciona testes unitários sobre diagnósticos e regressão dos critérios de alerta.

## 0.9.1 — Diagnóstico de associação e inferência conservadora

- Contadores de radares próximos da malha, com/sem direção, inferidos em mão única e motivos de rejeição.
- Permite associação para via única claramente mais próxima entre outras físicas; continua rejeitando pistas paralelas próximas e bidirecionais sem direção.
- Serviço Android distingue malha indisponível de malha válida sem radares associados.
- Testes de regressão em direção conhecida/ausente e rodovias paralelas.

## 0.9.0 — Resiliência geográfica e antecipação de malha

- Chaves de cache mais finas (com busca compatível de regiões antigas) e cache de regiões vizinhas: encontra geometria salva que realmente cubra a localização, inclusive sem conexão.
- Limpeza de cache de malhas mais antigas além de 24 regiões e reutilização da conexão IndexedDB.
- Pré-carregamento direcional conservador de malha enquanto a interface está visível, sem perder cobertura na tentativa.
- Evita deixar a aplicação indicar malha indisponível durante pré-carregamento quando a região atual continua válida.
- Map Matching não marca conexão topológica da mesma via como ambiguidade automática.
- Novos testes para cache regional, plano direcional e continuidade do Map Matching.

# Changelog — Radar Alert

## 0.8.1 — confiabilidade da carga OSM

- Reduz o raio inicial de consulta OSM para 3 km, diminuindo o volume em regiões urbanas densas.
- No endpoint alternativo, tenta uma área menor de 1,8 km em vez de repetir a consulta grande.
- Reduz o timeout por endpoint para 18 segundos e alinha o timeout declarado na consulta Overpass.
- Converte abortos por timeout em mensagens claras, identificando host, duração e raio consultado.
- Registra cada tentativa OSM no diagnóstico e informa que o GPS continua ativo enquanto alertas de estrada ficam suspensos.
- Mantém a última malha em cache quando ela cobre a posição atual.


## 0.8.0 — Map Matching nativo em segundo plano

- Serializa a malha OSM local e as associações de radares para um formato compacto versionado.
- Adiciona método Capacitor para persistir a malha no armazenamento privado do app.
- Serviço Android carrega grafo direcionado e índice espacial local.
- Implementa map matching nativo conservador baseado em GPS, rumo, precisão, proximidade e continuidade.
- Calcula distância ao próximo radar na mesma `roadKey` e camada com Dijkstra, respeitando a direção das arestas e evitando retorno imediato pela mesma way.
- Suspende alertas quando a malha não está disponível, não cobre a posição, ou não há correspondência confiável.
- Remove o fallback nativo em linha reta para alertas em segundo plano.
- Atualiza arquivos, status e documentação para sincronização da malha e seus limites de cobertura.

## 0.7.0 — integração Android nativa

- Serviço de localização Android em primeiro plano, plugin Capacitor e alertas conservadores em segundo plano.
- PWA continua oferecendo map matching OSM enquanto a interface está visível.

## 0.8.2
- Adicionada terceira instância pública Overpass (VK Maps / maps.mail.ru) como fallback independente.
- Adicionado cooldown de 2 minutos após falha total para evitar repetição agressiva de consultas.
- Quando há malha local que cobre a posição, o cache é usado durante o cooldown em vez de suspender desnecessariamente a cobertura.
- Testes de fallback de endpoint e cooldown.


