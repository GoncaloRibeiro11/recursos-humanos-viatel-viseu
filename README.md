# Mapa de Recursos Humanos

Aplicacao local para gerir colaboradores, ferias, assiduidade e cartoes de identificacao.

## Iniciar o site

Usar o servidor Node, porque este permite gravar os dados no ficheiro JSON:

```powershell
cd "C:\Users\ribei\Documents\Recursos Humanos Viatel"
& "C:\Program Files\nodejs\node.exe" servidor-rh.js
```

Depois abrir:

```text
http://localhost:8080/
```

Na rede, usar o IP do PC que esta a servir o site:

```text
http://IP-DO-PC:8080/
```

Por segurança, o servidor só aceita ligações no próprio computador por defeito. Para o disponibilizar na rede, defina obrigatoriamente uma password:

```powershell
$env:HOST="0.0.0.0"
$env:RH_USER="rh"
$env:RH_PASSWORD="uma-password-longa-e-unica"
& "C:\Program Files\nodejs\node.exe" servidor-rh.js
```

Na rede, use apenas uma ligação confiável; Basic Auth sobre HTTP não cifra as credenciais. Para acesso remoto, prefira a versão Supabase publicada em HTTPS.

## Sincronizar dados

- `Enviar dados`: envia os dados deste navegador para o ficheiro `mapa-coordenacao-2026.json` do servidor.
- `Atualizar dados`: carrega para este navegador os dados que estao no servidor.

Nao usar `python -m http.server`, porque esse servidor nao consegue gravar alteracoes.
