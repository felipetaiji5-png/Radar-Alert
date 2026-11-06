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

# Radar Alert 0.15.1 — Correção do início do GPS nativo

Esta versão corrige uma falha introduzida na 0.15.0: uma malha OSM salva por uma revisão anterior (inclusive versões que não tinham `catalogRevision`) podia gerar o erro **“Malha OSM associada à revisão antiga do catálogo de radares”** e **derrubar todo o serviço Android antes do primeiro fix GPS**. Agora a incompatibilidade suspende **somente os alertas por rota**. O serviço GPS continua ativo e pode receber uma malha sincronizada mais recente.

### Correções

- `RadarTrackingService.java`: restauração tolerante a malha ausente, antiga ou corrompida; zera a cobertura e impede alertas com associações antigas, mas mantém o GPS rodando. O carregamento de uma região candidata inválida não apaga uma malha ativa já validada.
- `RadarTrackingPlugin.java`: informa `roadNetworkIssue` no status nativo, facilitando o diagnóstico da migração.
- `app.js` e `geo/native-sync.js`: operações `setRadars`, `setPreferences`, `setRoadNetwork` e `cacheRoadNetwork` são serializadas. O catálogo é ordenado de forma estável antes de ser enviado ao Android, evitando invalidar a revisão por simples reordenação das linhas do CSV.
- Versão e cache PWA atualizados; o verificador Android exige também a nova classe Java `RoadSnapshotRevision.java`.
- Testes adicionais de ordenação, concorrência, recuperação após erro e revisão Java. Os critérios para confirmar via/sentido e liberar alertas não foram afrouxados.

### Atualizar um projeto existente (Windows)

**Faça backup.** Extraia este ZIP e copie o **conteúdo** da pasta `RadarAlert-0.15.1` para a pasta onde já ficam `package.json` e `android/`. Substitua os arquivos Web, `android-template/`, `scripts/` e `tests/`, **sem apagar `android/`**. Não instale outra cópia aninhada dentro do projeto antigo. Depois execute:

```powershell
npm install
npm test
npm run check
npm run android:sync
npm run android:verify
npm run android:open
```

No Android Studio: **Gradle Sync**, **Build** e **Run** no S23. Não basta atualizar os arquivos da pasta: **é obrigatório recompilar o APK**, pois o defeito e a correção estão no serviço Java nativo. Você não precisa apagar os dados do app. Se o catálogo foi regravado em ordem diferente, as regiões offline da 0.15.0 podem ser invalidadas uma vez; o aplicativo deve sincronizá-las novamente após obter um GPS válido.

### Logs esperados após a atualização

- `Serviço Android [started]: ... Aguardando posição GPS.`
- `Primeira posição GPS recebida ...` — mesmo se a malha OSM antiga estiver incompatível.
- Se houver snapshot antigo: `Serviço Android [roadNetworkUnavailable]: ... GPS continua ativo ...`, **sem** o evento `stopped` provocado pela incompatibilidade.
- Após carregar uma região válida no WebView: `Rede viária sincronizada com Android: ...` e `Serviço Android [dataReloaded]`.

**Limitações:** uma região não baixada não está disponível offline. Sem malha associada à revisão corrente, não há alertas de rota; o app não inventa aproximações de radar. A compilação completa com Android SDK e a validação física no S23 ainda são pendentes nesta sessão.

---

# Histórico — Radar Alert 0.15.0

Aplicativo de avisos informativos de radares para São Paulo: PWA + WebView Capacitor + serviço Android de localização em primeiro plano.

## Destaques desta versão — cobertura regional para segundo plano

**O serviço Android pode agora reutilizar até 12 regiões OSM previamente sincronizadas**, mesmo com a tela bloqueada e sem acesso à internet. Quando o GPS deixa a região em uso, o serviço procura uma malha já salva que cubra a posição e a ativa automaticamente. Antes, conhecia apenas a última malha sincronizada.

- **Pré-carregamento útil no Android:** uma região buscada à frente é salva no cache nativo sem substituir a malha que está sendo usada na posição atual.
- **Preparar área do mapa:** na tela Mapa, arraste até a região desejada e toque em **Preparar área do mapa**. Requer monitoramento ativo, GPS recente e internet para uma região ainda desconhecida. Prepara uma região por clique; respeita os limites do Overpass. O raio típico é de até 3 km ou 1,8 km em fallback. O botão não faz download do Estado de São Paulo inteiro.
- **Integridade entre base e malha:** cada arquivo regional é vinculado ao identificador SHA-256 da revisão da base nativa de radares. Se o catálogo mudar, associações antigas deixam de ser elegíveis. Malhas inválidas ou incompatíveis não são ativadas.
- **Atualização nativa mais segura:** escrita atômica de arquivos, montagem de novos índices antes de substituir os ativos, bloqueio de concorrência com callbacks GPS e ausência de recargas quando o catálogo/malha não mudou.
- **Mapa sem CDN para Leaflet:** o código e o CSS do Leaflet são incluídos no build Vite, permitindo iniciar a biblioteca sem acessar o `unpkg.com`. **As imagens de mapa-base OSM ainda exigem rede ou cache de tiles existente.**
- **Diagnóstico mais preciso:** distingue uma única troca de via candidata de oscilação recorrente; exibe quantas regiões OSM foram sincronizadas com o Android. O histórico de ruas continua efêmero e não autoriza alertas.
- **Verificador Android:** `npm run android:verify` detecta se o serviço Java, o plugin e os assets Web estão desatualizados em relação ao projeto extraído.

### Limites que continuam existindo

Esta versão **não é uma base offline de todas as ruas de São Paulo**. Só há cobertura nos locais previamente baixados; a troca de regiões não faz download OSM em segundo plano. O Overpass ainda pode falhar ao buscar regiões desconhecidas. A identificação da via, os sentidos dos radares e a distância pelo grafo continuam sujeitos aos dados OSM/Pardal e às regras conservadoras. Em trajetos longos, podem existir lacunas; quando não há cobertura ou a via está incerta, os alertas por rota ficam suspensos.

A versão 0.15.0 passou em **132 testes do projeto**, incluindo verificações com `javac` do seletor/armazenamento regional (18 asserções Java). `npm run check` e a verificação visual estática de telas 320, 390, 430 e 1280 px também passaram. **O serviço Android completo não foi compilado contra o Android SDK nem executado em aparelho neste ambiente.** Os testes com stubs Java não substituem o build Gradle ou os testes no S23.

### Atualizar o Radar Alert já instalado no Windows

1. Faça uma cópia de segurança da pasta atual.
2. Extraia a 0.15.0 e **copie seus arquivos para a pasta que contém o `package.json` e seu diretório `android/` existente**. Substitua os arquivos Web, `android-template/` e `scripts/`. Não coloque a pasta extraída inteira dentro do projeto antigo e não apague sua pasta `android`.
3. Execute, nessa mesma pasta:

```powershell
npm install
npm test
npm run check
npm run android:sync
npm run android:verify
npm run android:open
```

4. No Android Studio, faça o Gradle Sync, selecione seu S23 e execute **Run**. Não basta copiar os arquivos do ZIP: `android:sync` aplica as classes Java novas e o build do Leaflet.
5. Teste o **Simulador de trajetos** e o painel Diagnóstico antes de dirigir. Testes de GPS real ou segundo plano devem ser realizados por passageiro ou em emulador, sem manusear o celular dirigindo.

O relatório `QA-REPORT.md` explica os testes realizados e as pendências para uma versão de produção.

---

# Histórico de versões

## 0.14.0 — interface e diagnóstico

Aplicativo de alertas de radares em São Paulo, com PWA e uma primeira integração Android nativa para manter a sessão GPS ativa em segundo plano.

## Novo na 0.14.0 — interface e identificação da via

A tela foi simplificada para funcionar melhor no celular: visual grafite, menos efeitos, botões mais legíveis, informações essenciais em destaque e dados secundários recolhíveis em **Detalhes da sessão**.

- **Veículo parado:** com velocidade GPS de até 3 km/h e sem rumo utilizável, a seção Diagnóstico informa **Aguardando movimento** e **Rua próxima**, em vez de sugerir uma confirmação. Esse estado é informativo e não altera a lógica de alertas.
- **Estabilidade da rua candidata:** acompanha apenas o nome da rua identificada e o instante de cada leitura válida durante a sessão, por até 3 minutos. Informa se houve troca entre vias (por exemplo, Alameda Alegrete e Alameda Santiago) ou se o mesmo nome apareceu continuamente. A indicação **não confirma** sentido, pista ou presença de radar. Não salva coordenadas nem histórico em disco.
- **Precisão no mapa:** círculo existente ganhou indicador e botão para ocultar/exibir. A área é uma **estimativa**, não um limite garantido de erro do GPS. Quando a última localização fica inválida/desatualizada ou o monitoramento para, o círculo anterior deixa de ser exibido como atual.
- **Diagnósticos menos repetitivos:** mensagens idênticas em poucos segundos são omitidas e alterações de via são agregadas no histórico de estabilidade, além do log textual.
- **Testes:** 123/123 testes JavaScript aprovados (11 novos). Telas estáticas inspecionadas nas larguras 320, 390, 430 e 1280 pixels, sem rolagem horizontal.

**Escopo e limites:** a 0.14.0 não modifica o motor de decisão de alertas, a base Pardal, nem o serviço Java Android. Não corrige a disponibilidade dos servidores Overpass ou as limitações de cobertura regional offline. O APK não foi compilado neste ambiente: `npm install --offline` não encontrou `@capacitor/android` no cache. Compile e valide no seu S23.

## Novo na 0.13.0 — arquitetura e telas dedicadas

Esta versão separa a aplicação em **Painel**, **Mapa**, **Diagnóstico** e **Radares** na navegação mobile, preservando a sessão ativa ao trocar de aba. Na tela grande, as quatro seções continuam visíveis na mesma página.

- **Cockpit para celular:** velocidade GPS em destaque, reconhecimento da via, distância por rota somente após confirmação e limite cadastrado quando existe. O **modo direção automático** simplifica a tela depois de três fixes consecutivos a pelo menos 12 km/h; só sai após cinco fixes abaixo de 4 km/h. É um comportamento **exclusivamente visual**, com opção para desligar em Ajustes.
- **Mapa maior:** controle Leaflet isolado em `ui/map-view.js`, mantendo acompanhamento, recentralização, alternativas, marcadores em lotes e trilha GPS temporária. A tela do mapa ocupa mais área no celular.
- **Centro técnico:** indicadores independentes de GPS, catálogo, cobertura OSM, confirmação da via e segundo plano, sem exibir porcentagens de confiança inventadas. A visão de ruas candidatas e o diagnóstico detalhado permanecem disponíveis.
- **Laboratório de trajetória:** três cenários **inteiramente fictícios**, usando os mesmos módulos `MapMatcher`, `RoadNetworkProvider` e `AlertManager` da aplicação: via única com radar, duas pistas paralelas e veículo parado. Pode executar ou avançar ponto por ponto. A simulação não usa localização real, não inicia serviço nativo, não emite sons, não mostra notificações e não se mistura com o monitoramento real.
- **Código modular:** apresentação separada em `ui/`, cenários e lógica de teste em `sim/`, geometria/alertas em `geo/`, orquestração ainda em `app.js`. Nenhuma reescrita arriscada do serviço Android ou dos algoritmos já testados.
- **Acessibilidade:** opção de contraste reforçado; navegação por tela no celular e alvos maiores para toque.
- **15 novos testes** de segurança de simulação, histerese do modo direção, arquitetura e saúde do sistema, somando **112/112 testes JavaScript**.

### Limitações e validação da 0.13.0

- Testes JavaScript aprovados e interface estática conferida em 320, 390, 430 e 1280 px, sem rolagem horizontal.
- **APK ainda não compilado nesta sessão.** Compile no Android Studio e faça teste físico no S23. A ausência de dependências npm no ambiente de geração impede `vite build` e `cap sync` aqui.
- O simulador **não valida** o comportamento do GPS real, a fidelidade da geometria OSM local nem o serviço Android com tela bloqueada. A associação de radares e a cobertura offline continuam com as limitações da 0.12.0.
- Em viagens longas, o monitoramento nativo ainda depende da última região OSM previamente sincronizada; não foi criado download regional completo offline nesta versão.

### Organização do projeto

```text
app.js                  # orquestração: GPS, catálogo, alertas e ponte Android
refined.css             # refinamento visual mobile/desktop 0.14
geo/road-stability.js   # mudanças de rua candidata em RAM (máx. 3 minutos)
geo/                    # motores geoespaciais existentes
ui/navigation.js        # navegação e seleção de telas
ui/map-view.js          # Leaflet, camadas e trilha GPS temporária
ui/match-panel.js       # diagnóstico visual de correspondência
ui/nearby-list.js       # lista de radares
ui/system-health.js     # indicadores factuais de saúde
ui/drive-mode.js        # histerese de modo direção visual
ui/simulator-panel.js   # controles do laboratório
sim/route-simulator.js  # cenários e reprodução sintética isolada
android-template/       # código Java nativo preservado
```

### Atualizar um projeto Android existente

Faça backup da pasta principal e preserve o diretório **`android/`** já configurado. Copie os arquivos da 0.14.0 para a raiz onde está o `package.json`, substituindo os arquivos Web e `android-template/`, mas **não copie a pasta 0.14.0 inteira para dentro da pasta antiga**. No PowerShell, execute:

```powershell
npm install
npm test
npm run check
npm run android:sync
npm run android:open
```

No Android Studio, sincronize o Gradle e execute o aplicativo no S23. O novo aplicativo deve apresentar quatro telas no rodapé, o botão de área de precisão no Mapa e o histórico de estabilidade no Diagnóstico, além do **Simulador de trajetos** na aba **Diagnóstico**. Para retornar aos arquivos da versão anterior, restaure seu backup.

## Novo na 0.12.0 — auditoria de confiabilidade e desempenho

- **Rumo sem falso movimento:** na Web e no Android, direção derivada entre dois pontos GPS só é aceita se o deslocamento superar a incerteza combinada das duas leituras (mínimo de 12 m), ocorrer em até 10 s e indicar velocidade plausível. O sensor continua sendo utilizado quando a velocidade medida é confiável.
- **Serviço Android não reutiliza direção antiga:** a cada posição, o rumo volta a ser desconhecido até haver nova evidência. Isso evita continuar avaliando a mesma direção depois de parar, perder bearing ou sofrer ruído GPS.
- **Map Matching protege histórico:** leituras de baixa precisão não entram no histórico de rumo; posições com horário repetido são recusadas; após 30 s sem leitura válida, o bônus de continuidade anterior é descartado.
- **Índice de segmentos otimizado:** busca de ruas considera as células da geometria, não uma enorme área determinada pelo comprimento do maior trecho do mapa. Elimina resultados repetidos da mesma aresta entre células; protege também consultas em trechos longos.
- **Cache OSM antigo imediato:** se a última região está disponível mas tem mais de 30 dias, a abertura usa o cache sem aguardar três tentativas de rede potencialmente lentas. Fica sinalizado como desatualizado. Use **Atualizar ruas OSM desta região** para forçar consulta e renová-lo.
- **Trilha GPS opcional:** no mapa, **Mostrar trilha GPS** visualiza até 50 posições aceitas, com linha tracejada. O histórico permanece apenas na memória da sessão, não é enviado nem armazenado, e é apagado ao parar, reiniciar ou limpar os dados. Não interfere em alertas nem confirma vias.
- **11 novos testes automatizados**, incluindo ruído, intervalos inválidos, segmentos longos e cache antigo.

**Importante:** a mudança no código Java só entra no seu APK quando você roda `npm run android:sync`, porque esse comando atualiza o `RadarTrackingService.java` em `android/`. Não altere manualmente o `android-template/` isoladamente. É necessário executar um novo build no Android Studio para validar o serviço nativo. Os testes JavaScript não compilam Java.

## Novo na 0.11.0 — interface e diagnóstico em casa

- **Painel visual reformulado:** layout mais compacto para Android, com status de GPS e dados no topo, ação principal em destaque, cores e contrastes revisados, botões com alvos de toque maiores e navegação inferior com item ativo.
- **Ruas candidatas comparáveis:** com GPS ligado, o painel mostra até quatro nomes distintos de vias próximas e respectivas distâncias laterais. Os 14 (ou mais) *trechos analisados* não são necessariamente 14 ruas; os resultados são agrupados pelo identificador de via e nível. **Não é uma estimativa de probabilidade e não confirma rumo.**
- **Diagnóstico sem movimento:** a comparação visual continua útil quando o veículo está parado. Os alertas permanecem suspensos sem correspondência e sentido confiáveis.
- **Mapa aprimorado:** vias alternativas com linha lilás tracejada, candidata principal âmbar, confirmada azul; botão para recentralizar e retomar acompanhamento do GPS, modo de expansão vertical e indicador de mapa livre/acompanhando. Arrastar o mapa pausa o acompanhamento até o usuário tocar no botão de centralização.
- **Menos trabalho no WebView:** a camada de até 120 marcadores próximos não é recriada a cada fix; GPS e via candidata continuam atualizados a cada posição. Redesenho de marcadores ocorre após deslocamento relevante ou prazo máximo.
- **Atualizações independentes:** *Atualizar radares* só atualiza a base Pardal. A consulta OSM forçada passa a ser uma opção específica na área do mapa, evitando o timeout de 18 segundos por engano quando só se quer atualizar os radares.
- **Sem alteração das regras de alerta na versão 0.11.0.** Na versão 0.12.0, o serviço nativo passou a tratar rumo incerto de maneira mais cautelosa. Permanecem as limitações de cobertura regional e confiabilidade das instâncias públicas Overpass.

## Melhorias anteriores (0.10.0 e 0.9.1)

- **Diagnóstico de associação:** cada carregamento informa os radares localizados a até 45 m de alguma via, quantos têm direção cadastrada, quantos não têm, quantos foram inferidos e os motivos de rejeição.
- **Sentido inferido com mais precisão:** admite radar sem direção em via de mão única claramente mais próxima, mesmo quando outra via está dentro do raio de 45 m; exige separação mínima de 15 m e pelo menos 1,8x para evitar selecionar pistas paralelas e cruzamentos incertos.
- **Mensagens Android corrigidas:** uma malha OSM válida, mas sem radares de via/sentido confirmados, não é mais anunciada como geometria indisponível.
- **Conservador por padrão:** não cria alertas por distância em linha reta; radares sem direção confiável continuam sem alertas de rota.

## Destaques da 0.9.0

- **Cache regional de malha OSM:** ao atravessar uma célula do cache ou perder a internet, a busca também reutiliza uma região vizinha já salva que realmente cubra a posição atual. Antes, apenas a chave exata era consultada.
- **Pré-carregamento direcional em primeiro plano:** durante deslocamento (a partir de 15 km/h com GPS preciso), solicita uma região à frente quando se aproxima da borda da malha. Só faz isso se a projeção realmente ultrapassar a região disponível, e respeita limites de requisição.
- **Continuidade em falhas de rede:** se o pré-carregamento falhar, uma malha anterior que ainda cobre a posição permanece ativa; sem inventar alertas quando a cobertura acaba.
- **Map Matching ajustado:** duas arestas topologicamente conectadas da mesma via não são tratadas automaticamente como vias concorrentes.
- **Armazenamento limitado:** mantém até 24 regiões de malha OSM em IndexedDB (regiões menos recentes são descartadas para limitar uso de espaço) e reutiliza a conexão do banco local.

Essas mudanças ajudam a continuidade **com o aplicativo visível** e no retorno a áreas já visitadas. O serviço Android com tela bloqueada ainda depende da última região sincronizada, não baixa novas malhas sozinho. Serviços Overpass públicos podem continuar falhando.

## O que esta versão faz

- Mantém a base Pardal SP e o motor geográfico OSM/Map Matching da versão 0.6.2.
- No Android, inicia um serviço em primeiro plano do tipo `location` após o usuário tocar em **Iniciar monitoramento** com o app visível.
- Mantém uma notificação persistente enquanto o serviço está ativo, com ação **Parar**.
- Obtém coordenadas por `LocationManager` nativo em thread dedicada, não pelo ciclo de vida do WebView.
- Sincroniza a lista local de radares e as preferências para o serviço Android, inclusive volume de voz.
- Solicita permissão de notificações somente quando o usuário habilita notificações nas preferências.
- A ação de limpar dados também apaga a cópia da base e preferências do serviço nativo.
- Envia os fixes GPS ao WebView quando ele está ativo, para manter o mapa e o Map Matching existentes.
- Sincroniza com o serviço Android a malha OSM local carregada pelo app: arestas direcionadas, nós, `roadKey`, camada, comprimento e radares associados.
- Quando o WebView fica suspenso, o serviço nativo executa map matching local sobre a malha sincronizada e calcula distância pela estrada com Dijkstra, sem depender de rede.
- Se a malha não estiver disponível, a posição estiver fora da cobertura carregada ou o map matching for ambíguo, os alertas de rota em segundo plano são suspensos. Não há fallback silencioso para distância em linha reta.

## Cobertura de malha no segundo plano

A malha OSM é obtida pelo app enquanto está visível e depois transferida ao serviço nativo por arquivo local. A consulta ao Overpass não é feita pelo serviço em segundo plano. Cada endpoint tem limite de 18 segundos; o segundo endpoint recebe uma consulta menor para aumentar a chance de resposta em regiões densas. A área carregada é local (raio inicial de 3 km; em falha do primeiro endpoint, tenta uma região menor de 1,8 km); quando o veículo ultrapassa aproximadamente 72% desse raio a partir do centro baixado, o serviço suspende alertas por rota e aguarda o app voltar ao primeiro plano para carregar/sincronizar uma nova região. Isso evita alertas de rota fora da cobertura, mas significa que viagens longas com a tela bloqueada ainda podem ter lacunas de cobertura.

A malha transferida contém apenas segmentos OSM rodoviários suportados pelo parser. Restrições complexas de conversão, regras condicionais, mudanças de via e certos cruzamentos/retornos não são modelados como um navegador de rotas completo. Radares só são alertados quando têm associação unívoca à malha e direção utilizável.

## PWA / execução web

Requisitos: Node.js 22.12 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. Em um telefone, publique em HTTPS. No navegador comum, o GPS continua sujeito às limitações de suspensão do browser; a integração nativa só existe no aplicativo Android.

## Criar o projeto Android

Requisitos:
- Node.js 22.12+.
- Android Studio 2025.2.1 ou posterior compatível com Capacitor 8.
- Android SDK instalado pelo SDK Manager.
- Dispositivo Android ou emulador para teste.

Na primeira vez, na pasta do projeto:

```bash
npm install
npm run android:add
npm run android:open
```

`android:add` executa o build web, gera o projeto Android pelo Capacitor CLI e aplica o plugin/serviço nativo e as permissões.

Para atualizar depois de modificar o código:

```bash
npm run android:sync
npm run android:open
```

No Android Studio, aguarde a sincronização do Gradle e execute em um dispositivo.

## Teste físico recomendado

1. Instale o app no Android.
2. Abra-o e aguarde a base de radares carregar.
3. Toque em **Iniciar monitoramento** com o app visível.
4. Conceda **Localização precisa**. A permissão de notificações é solicitada somente quando essa opção é ativada; sem ela, os alertas por voz continuam funcionando. No Android 13+, a notificação do serviço pode não aparecer na gaveta quando a permissão de notificações for negada, embora o serviço continue listado pelo sistema em Aplicativos ativos.
5. Confirme a notificação persistente “Radar Alert · monitoramento ativo”.
6. Pressione Home ou bloqueie a tela; não force o encerramento do app.
7. Faça o teste como passageiro, ou em rota simulada no emulador. Não manuseie o aparelho dirigindo.
8. Para encerrar, volte ao app e toque em **Parar monitoramento**, ou use a ação **Parar** na notificação persistente.

O serviço começa apenas após ação explícita no app visível. Não tenta iniciar localização por conta própria após boot ou por um evento invisível. Se o GPS estiver desligado, o serviço aguarda e verifica periodicamente quando ele volta a ficar disponível.

## Permissões Android

O patch do projeto adiciona:
- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`
- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS`

Não adiciona `ACCESS_BACKGROUND_LOCATION`: a sessão usa um foreground service `location` iniciado pelo usuário enquanto a Activity está visível. O Android reconhece o serviço em primeiro plano como uso de localização em primeiro plano e mantém acesso durante a sessão, inclusive com a tela desligada. Consulte a documentação Android para requisitos por API e restrições de início de FGS.

A publicação no Google Play ainda exige avaliação de política, declaração/descrição adequada do uso de localização e justificativa do foreground service. A permissão de localização em segundo plano não deve ser adicionada sem necessidade e revisão específica.

## Privacidade

- O arquivo nativo salvo contém apenas os radares e campos necessários ao alerta; não grava histórico de GPS.
- Preferências e estado do serviço ficam em SharedPreferences locais.
- As coordenadas atuais são processadas localmente pelo serviço e enviadas ao WebView local por broadcast interno do app.
- A consulta OSM/Overpass e os tiles cartográficos continuam sujeitos às políticas dos respectivos provedores quando a interface carrega a malha/mapa.

## Testes

```bash
npm test
npm run check
npm run build
```

Os testes JavaScript validam a normalização de dados, o grafo OSM, as rotas e o formato de exportação para o serviço Android. Nesta entrega não foi possível compilar o APK/AAB nem executar testes Android físicos no ambiente de geração (sem Android SDK/Gradle instalado). A compilação final e validação do serviço nativo precisam ser feitas no Android Studio; a lógica Java de segundo plano ainda precisa de teste físico de percurso.

## Licenças e atribuição

- OpenStreetMap: © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright.
- Dados de radares: Pardal — https://github.com/Murkiriel/pardal; verifique obrigações ODbL para redistribuição.
- Leaflet: BSD 2-Clause — https://leafletjs.com/.

## Atualização anterior para a 0.12.0 no Windows

Se você já tem um projeto Android funcional, faça uma cópia da pasta por segurança. Com o Android Studio fechado, **copie os arquivos do ZIP da versão atual por cima dos arquivos do seu projeto atual**, mas **mantenha sua pasta `android/` atual**; não apague nem substitua a configuração nativa já gerada. Depois, abra o terminal na raiz do projeto e execute:

```powershell
npm install
npm test
npm run android:sync
npm run android:open
```

Aguarde o Gradle Sync no Android Studio e execute no seu celular. Como a identificação do aplicativo permanece `com.radalert.app`, o Android Studio pode instalar a nova build por cima da anterior; confirme o comportamento conforme a assinatura utilizada. O cache IndexedDB da versão anterior continua acessível por busca regional; a preferência e o serviço nativo existentes são preservados se os dados do app não forem apagados.

> Limitações de validação: a suíte Node cobre o código JavaScript e simuladores de Overpass. O build Vite, a compilação Java/Android, respostas atuais das instâncias Overpass e os alertas em trajeto real devem ser validados no ambiente de desenvolvimento/dispositivo Android.

## Histórico da 0.10.0: painel de via e ergonomia mobile

- A tela inicial apresenta a via identificada (ou apenas candidata), afastamento GPS-via, diferença angular, rumo estimado e número de segmentos candidatos. **Não apresenta percentual de confiança fictício**: a classificação continua qualitativa.
- Uma candidata incerta é desenhada em âmbar tracejado no mapa; uma via confirmada é azul. Essa visualização é diagnóstica, não autoriza alertas por rota.
- No modo celular: controles principais próximos do topo, textos e áreas de toque maiores, seção de equipamento recolhível, navegação inferior com atalhos para Painel, Minha via, Mapa e Radares, mapa ampliado e janelas de preferências/diagnóstico em formato de folha inferior.
- O botão **Ver detalhes** abre o diagnóstico completo; **Copiar Diagnóstico** inclui um resumo sem coordenadas geográficas.
- A geometria e os critérios de validação dos alertas, o foreground service Android e os dados Pardal permanecem inalterados. A instrumentação do Map Matcher foi expandida apenas para exibir motivos e métricas.
- Interface WebView ainda precisa ser validada visualmente e no GPS real do S23. Faça os testes parado ou como passageiro; não opere o celular enquanto dirige.

### Como interpretar o novo cartão “Onde estou na malha?”

- **Via confirmada:** o algoritmo considerou a via e o rumo suficientemente confiáveis para **avaliar** radares associados. Isso não garante que exista um radar elegível à frente.
- **Via candidata / não confirmada:** a geometria está próxima, mas os critérios de segurança não foram satisfeitos; alertas por rota continuam suspensos.
- **GPS incerto ou desatualizado:** o último ponto foi rejeitado ou a última posição válida tem mais de 90 segundos; a via anterior não deve ser interpretada como atual.
- **GPS → via:** distância lateral aproximada entre o ponto GPS e o segmento candidato, **não** distância até o próximo radar.
- **Desvio do rumo:** diferença angular entre o deslocamento estimado e a orientação do segmento; `—` significa direção indisponível.
- **Trechos analisados:** quantidade de segmentos que passaram pelo filtro preliminar do Map Matcher. Não é o número de ruas diferentes.
- **Vias consideradas:** lista resumida de até quatro vias por nome identificadas na malha. A distância apresentada é lateral à geometria, não ao radar, e a lista é somente informativa.

O cartão é diagnóstico do processo executado no **WebView enquanto visível**. O foreground service Android segue seu próprio motor de correspondência para alertas com a tela desligada. A versão 0.12.0 também melhora a qualidade de rumo no serviço Android, mas **não garante equivalência integral dos resultados** entre os dois motores.
