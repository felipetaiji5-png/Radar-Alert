# Verificação — Radar Alert 0.17.2

Data: 06/11/2026. Ambiente: Windows, Node 24.11.1, Java 21, Edge via Playwright e Android SDK 36.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Testes Node | 200 aprovados, zero falhas e zero ignorados |
| Java | Políticas de regiões, revisão, armazenamento e idade GPS compiladas/executadas na suíte Node |
| Navegador | 25 grupos aprovados; relatório em BROWSER-QA-REPORT.json |
| Layout | 4 telas em 7 larguras (320–1440 px), sem overflow horizontal |
| Sintaxe | npm run check aprovado |
| Web/Android | Build web, sincronização e verificação de templates aprovados |
| APK | :app:assembleDebug concluído; pacote com.radalert.app, versão 0.17.2, código 17002 |

## Verificação visual

- Estados inicial, referência, direção e alto contraste inspecionados em capturas do navegador.
- Botões iniciar e parar acima da navegação em 390 × 844.
- Lista com placas de limite, painel, mapa e diagnóstico verificados em 28 combinações com dados fictícios carregados.
- Movimento reduzido, teclado e restauração de preferências continuam verificados.

## Correção de relógio e continuidade

A validação Android usa o relógio monotônico desde a inicialização, conforme a [documentação Location](https://developer.android.com/reference/android/location/Location#getElapsedRealtimeNanos()). O timestamp civil do GPS não decide validade nem ordem. A ponte preserva a idade real na entrega à WebView. Os testes Java cobrem relógio civil adiantado/atrasado, broadcast atrasado, leitura expirada/inválida e recuperação limitada após silêncio, respeitando parada e GPS desativado. O serviço preserva START_STICKY depois de recarregar dados.

A suíte de navegador verifica que pagehide e eventos de recuperação não param o monitoramento nativo simulado. Esses testes não executam o ciclo de vida real do serviço Android: o APK foi compilado, mas encerramento/recriação pelo sistema e funcionamento físico continuam pendentes.

## Correção do GPS parado

O serviço nativo solicita posições com deslocamento mínimo zero também em STOPPED, mantendo o intervalo de 6 segundos. O filtro anterior de 5 m podia impedir novas leituras enquanto parado. A suíte Node verifica três minutos de leituras estacionárias, rumo desconhecido, referência sem alerta, expiração real após 90 segundos sem leitura e recuperação. Esse teste simula a sequência de posições; não executa o provedor GPS Android.

Referência da API: https://developer.android.com/reference/android/location/LocationManager#requestLocationUpdates(java.lang.String,long,float,android.location.LocationListener,android.os.Looper)

## Casos de regressão

- GPS parado sem OSM mostra 111 m e limite 50 da fixture, sem anúncio automático.
- Ilustração acompanha aproximação de 111 m para 56 m e afastamento, sem movimento independente do GPS.
- Leitura antiga/futura não inicia posição nem exibe limite; leitura atual recupera o painel.
- Erro temporário desaparece após nova leitura válida. GPS recusado oculta valores e ilustração.
- Eventos atrasados de uma sessão encerrada não atualizam a seguinte.
- Download OSM concluído após rejeição do GPS não emite alerta.
- Via OSM fictícia confirmada exibe 111 m pela via, limite 50 e somente um anúncio nos fixes repetidos.
- Limpeza durante download cancela a rede, esvazia IndexedDB/mapa, restaura volume/distâncias e permite atualização manual.
- Ponte Android simulada: rejeição do GPS, GPS desligado, recuperação, falha ao parar e limpeza durante início atrasado.
- PWA reabre offline com arquivos e base local. Navegação, mapa, simulador, preferências, foco e Escape continuam funcionais.

Os dados, posições e respostas da ponte Android usados no navegador são fictícios. A compilação do APK confirma a integração do código Java com o SDK, mas não equivale à execução em aparelho.

## Reprodução

```powershell
npm ci
npm test
npm run check
npm run android:sync
npm run android:verify
```

Para os testes de navegador, disponibilize o pacote Playwright e um navegador Chromium. O script aceita `RADAR_PLAYWRIGHT_PATH` (caminho do módulo), `RADAR_BROWSER_EXECUTABLE` (executável) e `RADAR_QA_OUTPUT` (pasta de resultados). Depois execute `npm run test:browser`. O servidor e as fixtures são locais; não é necessário GPS real. O JDK deve estar no PATH para executar os testes Java, em vez de ignorá-los.

## Ainda depende do aparelho

- Permissões e primeiro fix de GPS físico.
- Qualidade da posição parado e em deslocamento, dados reais da região e correspondência com a sinalização.
- Áudio real, volume e comportamento de notificações.
- Monitoramento com tela bloqueada, retorno ao app, economia de bateria e perda/retorno de GPS e internet.
- Atualização sobre a assinatura do APK já instalado.

As instâncias públicas Overpass podem continuar indisponíveis. Nessa situação, o painel apresenta referência em linha reta com GPS válido; alertas de rota dependem de uma malha disponível e de sentido confirmado.

Resultados históricos estão em docs/HISTORICO-QA-ate-0.16.1.md.

