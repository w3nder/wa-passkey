# wa-passkey

Ferramentas e engenharia reversa do fluxo de **passkey (Shortcake)** do WhatsApp Web —
a verificação por chave de acesso exigida ao vincular um dispositivo companion em contas
no rollout. Companion da integração em [w3nder/whatsmeow](https://github.com/w3nder/whatsmeow)
(ver `passkey.go` / `passkeyauth/`).

## O problema

Algumas contas exigem uma **assertion WebAuthn** ao vincular um companion (web/whatsmeow):
o servidor envia uma notificação `passkey_prologue_request` e o vínculo só conclui se a
assertion for fornecida. Uma lib headless **não consegue assinar sozinha** — precisa de um
authenticator que detenha a chave privada da passkey **já registrada na conta**.

Regra-chave do browser: `navigator.credentials.get({ rpId: "whatsapp.com" })` **só roda na
origem `web.whatsapp.com`**. Por isso a assinatura acontece dentro dessa página (via extensão).

## Conteúdo

```
extensions/
  bridge/     Extensão Chrome: assina a assertion no web.whatsapp.com e entrega ao whatsmeow
              (HTTP local 127.0.0.1:7799). Resolve a CSP usando o service worker.
  checker/    Extensão Chrome: botão que verifica se a conta TEM passkey e ONDE ela está
              (platform = neste device / cross-platform = celular).
tampermonkey/
  passkey-bridge.user.js   Versão userscript do bridge (Tampermonkey + GM_xmlhttpRequest).
docs/
  PROTOCOL.md  Protocolo Shortcake revertido (IQs, crypto do verification code, HKDF, etc.).
```

## Como usar o bridge

1. Rode o whatsmeow com o `BrowserPasskeyAuthenticator` servindo em `127.0.0.1:7799`
   (ver `cmd/passkeytest -mode bridge` no fork).
2. Instale `extensions/bridge` em `chrome://extensions` (Modo desenvolvedor → Carregar sem
   compactação), ou o userscript do Tampermonkey.
3. Abra uma aba **logada** do `web.whatsapp.com`.
4. Escaneie o QR; quando o servidor pedir a passkey, o browser assina (Touch ID / celular) e
   o whatsmeow conclui o vínculo.

## Como usar o checker

Instale `extensions/checker`, abra o `web.whatsapp.com` e clique no botão **🔑 Verificar passkey**.
Ele mostra se a conta tem passkey e onde está:

- **platform** → neste dispositivo (ex.: Touch ID do Mac) → assina sem celular, sem Bluetooth.
- **cross-platform** → celular/chave → precisa dele por perto (Bluetooth / hybrid).

## Limites (honestos)

- **Criar/registrar** passkey **não existe** no WhatsApp Web (é Meta Accounts Center / app do
  celular). Logo, não dá pra registrar uma passkey de software headless.
- A assertion só roda na origem `web.whatsapp.com` → um front próprio (React/Vue) **não** assina;
  só orquestra/exibe.
- Conta **sem** passkey vincula normal por QR, **sem** browser. Passkey é opt-in.
