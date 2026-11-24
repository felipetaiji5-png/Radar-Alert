# Radar Alert

O Radar Alert usa o GPS, a base de radares do Pardal em São Paulo e a malha viária do OpenStreetMap para avisar sobre radares à frente na via e no sentido de deslocamento. Funciona no navegador como PWA e no Android com monitoramento em segundo plano. Sem cobertura viária válida ou com a via incerta, os alertas por rota ficam suspensos. A sinalização da via prevalece.

## Executar no navegador

Na raiz do projeto, com Node.js 22.12 ou superior, execute:

```sh
npm ci
npm run dev
```

Abra <http://localhost:5173>. No Windows, também é possível iniciar pelo [run-windows.bat](run-windows.bat). Para usar o GPS pelo navegador de um telefone, sirva o aplicativo por HTTPS.

## Trabalhar no projeto

| Tarefa | Onde começar |
| --- | --- |
| Alterar o aplicativo web | [Página principal](index.html), [inicialização e eventos](app.js), [leitura do catálogo de radares](core.js) e [componentes da interface](ui/) |
| Investigar a via, a cobertura ou um alerta | [Lógica geográfica](geo/) e [simulador de rotas](sim/) |
| Executar ou alterar o Android | [Guia Android](docs/android.md), [código nativo](android-template/) e [scripts de integração](scripts/) |
| Verificar uma mudança | [Testes do projeto](tests/) e comandos abaixo |
| Consultar mudanças anteriores | [Changelog](CHANGELOG.md), [notas detalhadas por versão](docs/notas-historicas.md) e [relatório histórico de testes](docs/QA-REPORT.md) |

```sh
npm test
npm run check
npm run build
```

A suíte usa `java` e `javac` para os testes nativos isolados. Use um JDK 21 para incluí-los. O build web gera `www/`, que o projeto Android usa na sincronização.

## Licenças e atribuição

### Licença do código e dos dados

A [licença MIT](LICENSE) cobre o código próprio do Radar Alert. A base de radares do Pardal e os dados cartográficos do OpenStreetMap continuam sob a [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- OpenStreetMap: © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright.
- Dados de radares: Pardal — https://github.com/Murkiriel/pardal; verifique obrigações ODbL para redistribuição.
- Leaflet: BSD 2-Clause — https://leafletjs.com/.

Os avisos distribuídos com o aplicativo estão em [ATTRIBUTION.txt](ATTRIBUTION.txt) e [ATTRIBUTION-OSM.txt](ATTRIBUTION-OSM.txt).
