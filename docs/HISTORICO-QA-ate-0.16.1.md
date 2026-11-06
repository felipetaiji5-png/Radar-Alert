# Radar Alert 0.16.1 — ilustração de proximidade

O painel ganhou uma mini ilustração 2D com um carro, uma rua e o radar selecionado. O carro fica fixo; o radar se aproxima ou se afasta conforme a distância calculada pelo aplicativo muda.

## Como ler

- Escala linear de **0 a 1 km**, com referência intermediária de 500 m.
- Acima de 1 km, o radar fica na borda e continua mostrando sua distância numérica real.
- O equipamento ilustrado é o mesmo do painel principal. Um radar confirmado pela rota usa distância pela via; uma referência geográfica usa distância em linha reta, com indicação de via não confirmada.
- A rua é ilustrativa: não representa mapa, curva, faixa, lado da pista ou posição exata do equipamento.
- O desenho só muda de posição quando recebe uma nova distância. Não há contagem regressiva por velocidade nem movimento automático com o veículo parado.
- Se o radar selecionado mudar, o novo equipamento aparece diretamente na posição correspondente. GPS recusado/desatualizado, monitoramento desligado ou ausência de equipamento removem o marcador.
- A animação respeita a preferência de movimento reduzido do sistema.
- Corrigida uma mensagem antiga de GPS impreciso que permanecia no painel após uma nova leitura válida.

## Testes — 05/11/2026

- **186 testes Node aprovados**, incluindo 14 testes novos de projeção visual, seleção, limites da escala e limpeza do marcador.
- **13 grupos de testes de navegador aprovados**. A aproximação de 111 m para 56 m e o afastamento foram verificados com GPS fictício. Também foram verificados perda/recuperação do GPS, animação normal e movimento reduzido.
- Mantidas as verificações de navegação, preferências, simulador, mapa, reabertura offline e 28 combinações de tela/largura sem rolagem horizontal.
- Build web, sincronização Android e compilação :app:assembleDebug concluídos.
- APK debug 0.16.1, código 16001, pacote com.radalert.app. Testes físicos em aparelho, áudio real e execução com tela bloqueada continuam pendentes.

## Instalação e atualização

O arquivo RadarAlert-0.16.1-debug.apk é uma versão para teste, assinada com chave de desenvolvimento. Só substitui um aplicativo instalado com assinatura compatível. Em caso de conflito de assinatura, recompile o código-fonte com a chave do projeto existente; não é necessário apagar o aplicativo.

O ZIP contém fontes, testes e build web em www/. Para atualizar o projeto, copie seu conteúdo para a raiz existente preservando android/ e .git/. Depois execute:

~~~powershell
npm ci
npm test
npm run android:sync
npm run android:verify
npm run android:open
~~~

No Android Studio, compile e instale a nova versão. Em projeto novo sem android/, use npm run android:add. O roteiro de testes de navegador permanece disponível em tests/browser/qa.mjs; consulte as instruções da versão 0.16.0 abaixo para executá-lo.

---

# Radar Alert 0.16.0 — visual renovado

Interface escura com verde-lima, números maiores, painel mais organizado e navegação por telas também no desktop. Inclui todas as correções da 0.15.3: limite cadastrado e distância em linha reta continuam disponíveis sem OSM, com GPS válido e radar na base.

## O que mudou

- Painel com velocidade, distância e limite em destaque; observações ocupam uma faixa separada.
- Novo visual para mapa, lista de radares, diagnóstico, simulador e ajustes.
- Ícone atualizado no PWA e no Android; versão Android sincronizada com package.json.
- Modais com foco de teclado contido, fechamento por Escape e retorno ao controle de origem; campos de ajustes identificados por rótulos.
- Mensagem de falha do OSM mais curta no painel; o erro completo permanece no diagnóstico.
- Navegação desktop exibe uma seção por vez, preservando a sessão GPS.
- Distinção entre referência geográfica sem alerta e radar confirmado por rota mantida.

## Resultados verificados — 05/11/2026

- **172 testes Node aprovados**, zero falhas e zero ignorados, incluindo testes Java isolados com JDK 21.
- **12 grupos de verificações de navegador aprovados**, com GPS/base/voz controlados para teste. A voz foi interceptada: o teste verifica o acionamento, não o áudio físico.
- **28 combinações de layout**: Painel, Mapa, Diagnóstico e Radares nas larguras 320, 360, 390, 430, 768, 1024 e 1440 px, sem rolagem horizontal.
- Verificadas visualmente capturas do painel mobile, desktop, lista de radares e ajustes.
- Testados início/parada, radar a 111 m com limite 50 sem OSM, controles do mapa, simulador, persistência de ajustes, foco/Escape, modo direção e recusa de permissão GPS.
- PWA recarregada sem internet com app-shell e base local disponíveis.
- npm run check, npm run build, android:sync e android:verify aprovados.
- **APK debug compilado** com Gradle 8.14.3/JDK 21/SDK 36: :app:assembleDebug. Assinatura APK v2 verificada; pacote com.radalert.app, versão 0.16.0, código 16000, Android mínimo 7.0/API 24.

Os testes do navegador usam equipamentos e posições fictícios e falhas de rede controladas. Não comprovam atualização dos dados públicos, áudio físico, precisão de GPS real, comportamento no WebView do S23 ou continuidade com a tela bloqueada. Não houve instalação em aparelho nesta sessão.

## Arquivos de entrega

- RadarAlert-0.16.0-debug.apk: APK para teste, assinado com chave de desenvolvimento. Não é uma release assinada para loja.
- RadarAlert-0.16.0.zip: fontes, testes e build web em www/. A pasta android/ gerada não é incluída, para preservar projetos Android existentes.
- Prévias mobile/desktop: capturas reais do navegador com dados fictícios de teste.

## Atualizar

Para testar o APK no celular, abra RadarAlert-0.16.0-debug.apk e siga a instalação do Android. Ele só substitui uma instalação existente se a assinatura for compatível. Se o Android apontar conflito de assinatura, não é necessário apagar o app: use o código-fonte para recompilar com a chave do seu projeto.

Para atualizar o projeto existente, faça backup e copie o conteúdo de RadarAlert-0.16.0 para a raiz onde ficam package.json e android/. Preserve android/ e .git/.

~~~powershell
npm ci
npm test
npm run check
npm run android:sync
npm run android:verify
npm run android:open
~~~

No Android Studio, compile e instale o app. Em projeto novo sem android/, use npm run android:add. Para compilação por terminal, com JDK 21 e Android SDK configurados:

~~~powershell
cd android
.\gradlew.bat :app:assembleDebug
~~~

## Reproduzir testes de navegador (opcional)

O pacote Playwright não é dependência do aplicativo. Para executar o teste adicional:

~~~powershell
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run build
npm run test:browser
~~~

O teste inicia um servidor local, usa um perfil temporário, injeta GPS e base fictícios e gera capturas e report.json em qa-results/. Não usa o perfil pessoal nem pede localização real. As variáveis RADAR_PLAYWRIGHT_PATH, RADAR_BROWSER_EXECUTABLE e RADAR_QA_OUTPUT permitem selecionar uma instalação existente do Playwright, o executável Chromium/Edge e o diretório de resultados.

---

# Radar Alert 0.15.3 — limite e distância sem depender do OSM

## Correção do painel

A versão anterior encontrava referências geográficas próximas, mas só preenchia o limite e a distância do painel principal quando existia um radar confirmado pela malha viária. Parado, sem rumo confiável ou com falhas nos servidores OSM, os dois campos ficavam em branco.

Agora, com monitoramento ativo, uma posição GPS válida e radares na base:

- O painel mostra o equipamento ativo mais próximo em até 5 km como **Radar próximo · referência**.
- Exibe a **distância aproximada em linha reta** e o **limite cadastrado desse radar**, inclusive parado e sem malha OSM.
- A referência pode estar em outra rua ou sentido; ela não confirma o limite da via do veículo e não emite alertas.
- Um radar confirmado pela rota tem prioridade, com a indicação **Distância pela via**.
- Radar sem limite cadastrado continua mostrando um traço nesse campo. Nenhum limite é estimado.
- Ao parar o monitoramento, receber um fix recusado ou ficar com GPS desatualizado, o painel limpa a distância e o limite anteriores. A expiração é revista a cada 15 segundos enquanto a página está visível.
- A busca visual inclui radares muito próximos, inclusive a menos de 8 metros, e não depende de rumo residual quando o veículo está parado.

O avaliador de alertas e as classes Java de produção não foram alterados. Referências geográficas não recebem distância de rota nem autorização de alerta. Esta correção não resolve a disponibilidade dos servidores Overpass.

## Validação em 05/11/2026

- **172 testes aprovados**, zero falhas e zero ignorados, incluindo 19 novos testes de seleção e preenchimento do painel.
- Verificação de sintaxe e build web aprovados.
- Testes Java isolados executados com JDK 21.0.8; os substitutos de Android usados nesses testes não equivalem a execução em aparelho.
- Nos testes de apresentação, um radar sintético a aproximadamente 111 m, com limite de 50 km/h, preenche corretamente o painel sem malha OSM.
- Não foi executada validação visual em navegador/WebView nesta versão. APK e GPS em aparelho não foram compilados/testados nesta sessão.

## Atualizar no Android

Faça backup. Copie o conteúdo da pasta RadarAlert-0.15.3 para a raiz do seu projeto existente, onde fica package.json. Preserve android/ e .git/.

~~~powershell
npm ci
npm test
npm run check
npm run android:sync
npm run android:verify
npm run android:open
~~~

No Android Studio, faça o build e instale o APK atualizado. Apenas substituir os arquivos no computador não atualiza o aplicativo no celular. Confirme **v0.15.3** na interface.

Teste com o veículo parado: inicie o monitoramento, aguarde uma posição GPS válida e confira o painel. Se houver um equipamento ativo da base a até 5 km, deve aparecer a referência e sua distância, mesmo que o diagnóstico indique ausência de malha OSM. O limite só aparece quando está preenchido na base.

O ZIP contém código-fonte e build web em www/; não contém APK.

---

# Radar Alert 0.15.2 — confiabilidade offline e recuperação

## Melhorias

- A base de radares em cache é aplicada antes dos downloads. A consulta ao catálogo ocorre em paralelo e deixa de bloquear a inicialização da base por até 9 segundos. Sem internet informada pelo navegador, a abertura não tenta baixar catálogo ou CSV.
- Downloads inválidos não sobrescrevem a base local. A atualização manual preserva a base já carregada quando a rede falha. Chamadas simultâneas de carregamento compartilham a mesma operação.
- Respostas Overpass vazias, sem segmentos utilizáveis ou com aviso de execução incompleta passam para o servidor alternativo. Se todos falham, uma malha válida em cache continua disponível. O controle de intervalo entre consultas permanece ativo.
- Falhas de gravação não descartam dados válidos em memória. Base e malha informam quando não foi possível confirmar o armazenamento offline; o painel deixa de confundir data de download com garantia de cópia local.
- Preferências carregadas são validadas: tipos booleanos, volume entre 0 e 100 e distâncias disponíveis na interface. Um armazenamento local bloqueado não interrompe a aplicação das preferências na sessão. Atualizações nativas de preferências usam a fila de sincronização existente.
- Restaurado o stub AtomicFile ausente no ZIP original. A regra de exclusão de android/ agora se aplica apenas à raiz, preservando o stub de testes. Chamadas Java dos testes têm timeout para evitar espera indefinida.
- Incluídos package-lock.json e build web em www/.

## Verificação realizada em 04/11/2026

- npm test: **153 testes aprovados, zero falhas e zero ignorados**. São 16 testes novos, além dos 137 existentes.
- Testes Java isolados executados com JDK 21.0.8. AtomicFile e JSONObject são substitutos de teste; não comprovam comportamento do sistema Android.
- npm run check: aprovado.
- npm run build: aprovado com Node 24.11.1, npm 11.6.2 e Vite 7.1.12.
- Prévia no navegador integrado: não realizada; a conexão ao servidor local expirou.
- APK/Gradle, GPS real, voz e segundo plano em aparelho: não executados. O serviço Java de produção não foi alterado nesta versão.

## Atualizar o projeto existente

Faça uma cópia de segurança e copie o conteúdo da pasta RadarAlert-0.15.2 para a pasta que contém package.json e seu android/ existente. Preserve a pasta android/. Execute nessa pasta:

~~~powershell
npm ci
npm test
npm run check
npm run android:sync
npm run android:verify
npm run android:open
~~~

No Android Studio, compile e instale o APK atualizado. Para um projeto que ainda não tem android/, use npm run android:add no lugar de android:sync. Testes Java exigem java e javac do JDK 21 no PATH; se o launcher Java do Windows não responder, ajuste JAVA_HOME/PATH para seu JDK.

Para testar só a versão web: npm ci e npm run dev. Para abrir o build pronto, execute npm run preview e use o endereço mostrado no terminal.

## Limites

O pacote não contém APK. Não há download de todas as ruas de São Paulo nem garantia de cobertura offline fora das regiões salvas. A alteração não flexibiliza os critérios de via, pista e sentido para os alertas. Os testes de rede usam respostas controladas e não comprovam disponibilidade dos servidores públicos.

---

# Radar Alert 0.15.1 — Relatório de correção

**Problema reproduzido por análise de código:** o antigo `loadRoadNetwork()` propagava `IllegalStateException` quando o arquivo OSM persistido não continha a revisão atual do catálogo. `onStartCommand()` capturava a exceção fora do carregamento de GPS e chamava `stopTracking()`, interrompendo todo o monitoramento. Isso explica os eventos `error` e `stopped` dos logs de 05:46:50. A origem precisa do snapshot (arquivo legado ou uma atualização concorrente) não pode ser estabelecida apenas pelo log.

**Correção:** o serviço agora trata a falha da malha isoladamente (`restoreRoadNetworkOrSuspend()`), limpa grafo/associações, registra `roadNetworkIssue` e inicia o GPS. Uma região compatível pode ser ativada após sincronização. A integridade dos radares continua obrigatória para emitir alertas de rota.

**Verificação local:** 137 testes Node (todos passando), JDK 21 para classes Java isoladas, verificações de serialização e fila de sincronização, `npm run check` passou. A integridade do ZIP foi conferida. A compilação Gradle e execução no S23 dependem do seu Android Studio. Os testes de texto-fonte não são equivalentes ao build completo do serviço Android.

**Checklist do dispositivo:** após `npm run android:sync`, `npm run android:verify` e Gradle Build, inicie o monitoramento. Confirme `started`, fix GPS e ausência de `stopped` por malha incompatível. Quando a malha do cache Web estiver sincronizada, confirme contagem positiva de regiões. Para testar troca de regiões, use emulador ou passageiro e regiões já preparadas; durante a condução, não manipule a tela.

**Riscos remanescentes:** disponibilidade do Overpass, atualização de dados e lacunas de cobertura, orientação de radar ausente na fonte, falta de validação física. O sinal viário e os limites de velocidade prevalecem.

---

# Radar Alert 0.15.0 — Verificação de qualidade e riscos

Data: 2026-11-04. Base do projeto: Radar Alert 0.14.0. Escopo: revisão e evolução incremental, sem alterar os critérios que autorizam os alertas por rota.

## Evidência de verificação nesta sessão

| Verificação | Resultado | Limitação |
| --- | --- | --- |
| `npm test` | **132/132 aprovados** | Testes locais e regressões; não é teste de campo |
| Testes de seleção nativa (`javac`, 8 asserções) | Passou | Lógica pura Java sem Android SDK |
| Testes de armazenamento (`javac`, 10 asserções) | Passou | Dependências Android `AtomicFile` e JSON simuladas por stubs de teste |
| `npm run check` | Passou | Sintaxe JS, não faz build do Android |
| Layout estático em 320/390/430/1280 px | Sem rolagem horizontal | Não equivale à inspeção em WebView do S23 |
| Pacote ZIP | Inspeção de arquivos e integridade | Não é APK |
| `npm run build` e `npm run android:sync` | **Não realizados aqui** | Dependências npm/Android SDK indisponíveis no ambiente |
| GPS em movimento, tela bloqueada e notificações | **Pendente** | Requer S23 ou Android Emulator |

## Mudanças críticas e proteções

1. Cache nativo de até 12 regiões previamente sincronizadas, com seleção pela margem de cobertura de 72%. Regiões sem cobertura adequada não são selecionadas.
2. O cache de pré-carregamento não muda a malha ativa antes da hora, nem habilita alertas por aproximação em linha reta.
3. Snapshots nativos contêm identificador SHA-256 reduzido (12 caracteres hexadecimais) do catálogo. Uma revisão diferente invalida as associações. O serviço recupera a revisão do arquivo de radares ao iniciar, protegendo também atualizações interrompidas.
4. Novas malhas são montadas em mapas temporários e só substituem o grafo ativo após a validação; operações de leitura/avaliação e reload usam o mesmo bloqueio nativo.
5. Gravação atômica para catálogo, malha principal e arquivos regionais. Um dado inválido não autoriza alertas.
6. Os critérios de associação/Map Matching continuam conservadores: em pista/sentido incertos, os alertas por rota são suspensos.
7. Leaflet deixa de depender de CDN; o mapa-base de tiles não é offline garantido.
8. Reexportações idênticas não provocam recargas nativas desnecessárias.

## Testes essenciais no Android Studio

1. Na raiz correta do projeto: `npm install`, `npm test`, `npm run check`, `npm run android:sync`, `npm run android:verify`. `android:verify` deve mostrar cinco arquivos Java iguais aos templates e assets Web `v0.15.0`.
2. Gradle Sync e `:app:assembleDebug` sem erro. Instalar no S23; confirmar interface e versão.
3. Iniciar monitoramento com localização precisa; confirmar notificação nativa, chegada de fixes e carregamento de malha OSM e catálogo.
4. Na aba Mapa, preparar uma área próxima fora da malha ativa. Confirmar aumento do contador de regiões nativas no Diagnóstico, sem alterar prematuramente a via candidata atual.
5. Em emulador, simular trajeto por duas regiões preparadas previamente. Desligar internet e ocultar o app; confirmar evento `roadRegionSwitched`. Fora de todas as regiões, confirmar `roadNetworkCoverageEnded` e ausência de alertas de rota.
6. Testar atualização do catálogo: arquivos regionais antigos devem ser recusados até nova sincronização.
7. Testar alternância entre primeiro plano e segundo plano, voltar ao aplicativo e parar monitoramento. Não devem surgir alertas duplicados nem reutilização de via sem rumo confiável.
8. Validar distância, sentido e radar correspondente durante deslocamento seguro, com pessoa passageira operando o aparelho; o simulador fictício não prova precisão de campo.

## Limitações abertas

- Não existe download offline de todas as ruas de São Paulo; o cache regional cobre apenas as regiões que já foram obtidas. Um trajeto pode ter lacunas entre essas regiões.
- O Overpass público pode dar HTTP 502, 429, timeout ou estar indisponível; não há garantia de SLA. Uma operação que falha não deve ser anunciada como sucesso.
- As imagens-base do mapa (`tile.openstreetmap.org`) podem não aparecer sem internet, embora a biblioteca Leaflet esteja embutida.
- Radares da base Pardal podem carecer de direção cadastrada; o algoritmo deliberadamente não avisa quando não identifica pista e sentido com segurança.
- O algoritmo de distância segue a mesma `roadKey`/camada do grafo OSM e não implementa todas as conversões condicionais, acessos e rotas possíveis.
- Não foi gerado APK ou executado Gradle nesta sessão. Não declarar esta versão como pronta para produção sem o checklist acima.
- A sinalização oficial e os limites de velocidade prevalecem sobre as informações do app.
