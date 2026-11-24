# Executar o Radar Alert no Android

Use Node.js 22.12 ou superior, Android Studio com Android SDK e um dispositivo Android ou emulador. Execute os comandos na pasta que contém `package.json`.

## Primeira instalação

```sh
npm ci
npm run android:add
npm run android:verify
npm run android:open
```

O comando `android:add` gera `www/`, cria o projeto local `android/` e copia o serviço de localização, o plugin e os recursos do [modelo nativo](../android-template/). No Android Studio, aguarde a sincronização do Gradle, selecione o dispositivo e execute o aplicativo.

## Atualizar uma instalação existente

Se `android/` já existe, edite o código nativo em `android-template/`. As classes do modelo são copiadas novamente a cada sincronização. Depois de atualizar as dependências com `npm ci`, execute:

```sh
npm run android:sync
npm run android:verify
npm run android:open
```

O verificador compara as classes Java e a versão do conteúdo web copiado. Compile e instale a nova versão pelo Android Studio para aplicar as alterações no dispositivo.

## Verificar GPS e cobertura

1. Abra o aplicativo, aguarde o carregamento da base e toque em **Iniciar monitoramento**. Conceda localização precisa. A permissão de notificações é solicitada quando a opção é ativada nas preferências.
2. Com GPS recente e conexão, use **Preparar área do mapa** para salvar a malha de uma região. O serviço pode reutilizar até 12 regiões da revisão atual do catálogo.
3. Em um emulador ou como passageiro, bloqueie a tela e verifique a continuidade da sessão. Fora das regiões salvas, os alertas por rota ficam suspensos até haver cobertura válida.
4. Encerre em **Parar monitoramento** ou pela ação **Parar** da notificação.

O serviço processa as posições localmente. As consultas de malha ao Overpass e o carregamento dos mapas envolvem os respectivos provedores. O [relatório de testes](QA-REPORT.md) detalha cenários de migração e verificações em aparelho.
