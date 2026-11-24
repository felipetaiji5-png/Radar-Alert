# Radar Alert 0.19.1 — Verificação de 24 de novembro de 2026

O teste de regressão reproduziu um aviso duplicado após 125 segundos sem confirmação da via e apenas um segundo de ausência confirmada. Após a correção, o motor web cancela a contagem quando o radar reaparece antes de dois minutos. O teste também verifica que uma segunda passagem volta a gerar aviso no limite de dois minutos.

Passaram os 209 testes Node/Java, sem casos ignorados, a checagem de sintaxe e os 31 grupos de navegador com GPS simulado. Na primeira execução de navegador, o teste de reconexão tentou liberar a resposta simulada do mapa antes de a requisição chegar. O teste foi corrigido e a suíte completa passou ao ser repetida. A sincronização Android, a verificação das classes e a compilação debug passaram. O APK 0.19.1 tem código Android 19001 e o mesmo certificado do APK 0.18.0 publicado. Os recursos web, incluindo a licença da fonte, coincidiram com o build testado. GPS, voz e tela bloqueada em aparelho real seguem pendentes.

# Radar Alert 0.18.0 — Verificação da edição GPS

Em 24 de novembro de 2026, a integração dos fontes da edição de 22 de novembro passou nos 202 testes Node/Java, sem testes ignorados, e na checagem de sintaxe. Os 27 grupos de navegador passaram com GPS, catálogo e ponte Android simulados. Um dos fluxos recebeu posição com o catálogo pendente e sincronizou os dados após o download. As capturas do painel de referência em retrato e paisagem coincidiram com as da entrega original.

O build web, a sincronização e a verificação do projeto Android e a compilação Gradle de depuração passaram. O APK disponibilizado é o original da entrega. A assinatura foi verificada, o pacote é `com.radalert.app` e a versão é 0.18.0 (18000). Os arquivos web distribuídos no APK coincidiram com o build desta integração. [Checksum do APK](../downloads/RadarAlert-0.18.0-gps-debug.apk.sha256)

A recepção de GPS físico, a voz e a continuidade com a tela bloqueada em aparelho real permanecem pendentes.

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
