# Aniversarios RH no Telegram

O servidor envia os cartoes de vida e de empresa dos colaboradores ativos no dia do aniversario, independentemente de o site estar aberto. O destino e uma conversa privada ligada pelo administrador ao `@viatelviseubot`.

## Instalar

1. Executar `migrations/20261115_telegram_anniversaries.sql` no projeto Supabase RH. Nao executar o schema inicial nem restaurar dados.
2. No Vercel, adicionar `TELEGRAM_BOT_TOKEN` e `CRON_SECRET` como variaveis Secret/Sensitive, apenas em Production. O token pertence ao bot. O segredo de cron deve ser aleatorio, com pelo menos 32 caracteres. Nunca incluir estes valores em codigo, capturas ou conversas.
3. Publicar a nova versao para carregar as variaveis.
4. No RH, foto de perfil > Telegram > Ligar Telegram. Abrir a ligacao gerada, carregar em Iniciar no bot e confirmar a ligacao no RH. O codigo expira em 10 minutos e nao serve para ligar grupos.
5. Enviar a imagem de teste. Para receber os aniversarios do proprio dia apos uma instalacao tardia, usar Enviar aniversarios de hoje.

## Operacao

- O agendamento Vercel executa diariamente as 09:00 UTC, de manha em Lisboa (09:00 no inverno, 10:00 no verao). No plano Hobby pode executar dentro da hora seguinte. A data do aniversario e calculada em Europe/Lisbon.
- Os dois tipos de aniversario geram cartoes separados. Colaboradores inativos, entradas futuras e pessoas cuja data de saida ja ocorreu ficam excluidos.
- Um aniversario de 29 de fevereiro e observado a 1 de marco num ano nao bissexto, tal como no site.
- Cada entrega tem uma chave unica por pessoa, tipo, data e conversa. Repetir o pedido nao repete imagens enviadas. Falhas anteriores ao envio ou recusas explicitas do Telegram podem ser tentadas novamente, ate tres vezes.
- Um timeout depois de iniciar o envio pode significar que a imagem chegou. Esses casos ficam sem confirmacao e NAO sao repetidos automaticamente. Verificar a conversa Telegram antes de qualquer intervencao manual.
- A configuracao e os recibos estao em tabelas novas, com RLS e sem acesso anon/authenticated. Apenas as funcoes de servidor, depois de validar um administrador ou o segredo do cron, usam a chave de servico.
- Nao sao criadas imagens publicas. O PNG e carregado diretamente para o Telegram. Nao sao incluidos telefones, AGV, assiduidade nem observacoes dos colaboradores.
- O desenho e partilhado pelo browser e pelo servidor em `vercel-supabase/src/anniversary-card.mjs`. A fonte Roboto do servidor inclui a licenca OFL.
- A pausa so impede envios futuros; nao apaga imagens ja recebidas no Telegram.

## Verificar

`npm test` inclui datas, permissoes, pairing, concorrencia e falhas de entrega. `scripts/test-telegram-sql.cjs` valida as permissoes e os recibos numa base PGlite descartavel. `scripts/test-rh-browser.cjs` valida a interface e que os dados RH nao sao alterados.
