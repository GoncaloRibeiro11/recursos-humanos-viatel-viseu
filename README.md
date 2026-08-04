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

## Sincronizar dados

- `Enviar dados`: envia os dados deste navegador para o ficheiro `mapa-coordenacao-2026.json` do servidor.
- `Atualizar dados`: carrega para este navegador os dados que estao no servidor.

Nao usar `python -m http.server`, porque esse servidor nao consegue gravar alteracoes.
