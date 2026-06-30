# wa-passkey

**Uma** extensão Chrome para o fluxo de **passkey (Shortcake)** do WhatsApp Web — usada ao
vincular um companion (web/whatsmeow) em contas que exigem chave de acesso. Companion da
integração em [w3nder/whatsmeow](https://github.com/w3nder/whatsmeow) (`passkey.go` / `passkeyauth/`).

## O que a extensão faz (tudo em 1)

Ao abrir o `web.whatsapp.com`, aparece um widget no canto inferior direito:

- **Assina automático (bridge):** quando o whatsmeow (rodando local, `127.0.0.1:7799`) precisa da
  passkey para concluir o vínculo, a extensão roda o `navigator.credentials.get()` na origem certa
  (`whatsapp.com`) e devolve a assinatura. O status mostra se o whatsmeow está online.
- **🔑 Verificar passkey:** botão que checa se a conta tem passkey e **onde ela está**:
  - **platform** → neste dispositivo (Touch ID do Mac) → assina sem celular, sem Bluetooth.
  - **cross-platform** → celular/chave → precisa dele por perto (Bluetooth / hybrid).

## Instalar (1 passo)

1. Pegue a extensão:
   - **Zip pronto:** baixe `wa-passkey-extension.zip` na aba **Actions** (último build) ou em **Releases**
     (gerado automaticamente pela Action), e descompacte; **ou**
   - **Do código:** use a pasta `extension/` direto.
2. `chrome://extensions` → ative **Modo do desenvolvedor** → **Carregar sem compactação** → selecione a pasta.
3. Abra/recarregue uma aba **logada** do `web.whatsapp.com`.

## Por que precisa rodar no web.whatsapp.com

Regra do browser: `navigator.credentials.get({ rpId: "whatsapp.com" })` **só funciona na origem
`web.whatsapp.com`**. Por isso a assinatura acontece dentro dessa página (a extensão injeta ali), e
um front próprio (React/Vue, localhost) **não** consegue assinar — apenas orquestrar/exibir.

## Estrutura

```
extension/
  manifest.json   MV3
  background.js   fetch proxy p/ 127.0.0.1 (fura a CSP da página)
  content.js      widget (status + botão) e loop do bridge
  inject.js       WebAuthn na origem whatsapp.com (assinar + verificar)
docs/
  PROTOCOL.md     protocolo Shortcake revertido (IQs, crypto, HKDF, etc.)
```

## Limites (honestos)

- **Criar/registrar** passkey **não existe** no WhatsApp Web (é Meta Accounts Center / app do
  celular) → não dá pra registrar passkey de software headless.
- Conta **sem** passkey vincula normal por QR, **sem** browser. Passkey é opt-in.
