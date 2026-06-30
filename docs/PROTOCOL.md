# Shortcake passkey prologue — protocolo (reverse-engineered)

Documenta o fluxo de **passkey prologue** ("Shortcake") que o WhatsApp passou a exigir em
algumas contas ao vincular um companion device. Ref: tulir/whatsmeow#1185.

Tudo aqui foi extraído do bundle do cliente web oficial (módulos `WASmax*` / `WAWebShortcake*`).
O whatsmeow original apenas loga `passkey_prologue_request` como "unhandled" e o pareamento
**dá timeout** quando a conta está no rollout.

## Visão geral

Quando a conta exige passkey, em vez de completar direto pelo handshake ADV
(`pair-device` → `pair-success`), o servidor injeta um passo extra:

```
servidor → companion : <notification type="passkey_prologue_request"> (com o desafio WebAuthn)
companion            : faz a cerimônia WebAuthn (navigator.credentials.get) → assertion
companion → servidor : GetRef IQ            → recebe um "ref"
companion            : monta o ProloguePayload (ephemeral identity + commitment)
companion → servidor : SetPasskeyPrologue IQ (credential_id + webauthn_assertion + prologue_payload)
servidor             : libera → segue o pair-success normal
```

A cerimônia WebAuthn é o ponto crítico: exige uma **credencial (passkey) registrada sob
`rpId = "whatsapp.com"`** cuja **chave privada** o cliente controle. Um cliente headless não
tem isso por padrão (a passkey normal vive no enclave do celular, não exportável).

## 1. Notificação de entrada — `passkey_prologue_request`

```
<notification type="passkey_prologue_request" from="s.whatsapp.net" id="...">
  <passkey_request_options>{BYTES, 1..4096}</passkey_request_options>   <!-- OPCIONAL -->
</notification>
```

- `passkey_request_options` é um **blob opaco** (bytes) no nível Smax
  (`contentBytesRange(e,1,4096)`). É o `PublicKeyCredentialRequestOptions` serializado
  (challenge, `rpId="whatsapp.com"`, `allowCredentials`, `userVerification="required"`,
  timeout). O formato interno do blob vive em módulo lazy (não capturado) — precisa de
  captura ao vivo pra confirmar (provável protobuf/CBOR).
- Se a notificação **não** trouxer o blob, o cliente busca via IQ `GetPasskeyRequestOptions`
  (ver §4). O cliente cacheia o blob (`WAWebShortcakeLinkingRequestOptionsCache`).

Fonte: `WASmaxInMdPasskeyPrologueRequestNotificationRequest`,
`WASmaxInMdPasskeyRequestOptionsMixin`.

## 2. GetRef IQ (request)

```
<iq to="s.whatsapp.net" type="get" xmlns="md" id="...">
  <ref/>
</iq>
```

Resposta:

```
<iq type="result" ...>
  <ref>{BYTES}</ref>
</iq>
```

O `ref` vem como bytes e é decodificado como **texto UTF-8** (`new TextDecoder().decode`).
É usado em `initializeShortcakeLinking(ref, platformType)` pra montar o ProloguePayload.

Fonte: `WASmaxOutMdGetRefRequest`, `WASmaxInMdGetRefResponseSuccess`, `WASmaxMdGetRefRPC`.

## 3. SetPasskeyPrologue IQ (request)

```
<iq to="s.whatsapp.net" type="set" xmlns="md" id="...">
  <passkey_prologue>
    <credential_id>{BYTES}</credential_id>
    <webauthn_assertion>{BYTES}</webauthn_assertion>
    <prologue_payload>{BYTES}</prologue_payload>
    <pairing_handoff_proof>{BYTES}</pairing_handoff_proof>   <!-- OPCIONAL -->
  </passkey_prologue>
</iq>
```

- `credential_id` — o credential ID da passkey usada na assertion.
- `webauthn_assertion` — a **assertion serializada como JSON** (no cliente é `assertionJson`):
  campos padrão WebAuthn (clientDataJSON, authenticatorData, signature, userHandle — base64).
- `prologue_payload` — protobuf **`ProloguePayload`** (ver §5).
- `pairing_handoff_proof` — opcional; presente só no fluxo de handoff
  (`computePairingHandoffProof(handoffKey, prologuePayload)`).

Fonte: `WASmaxOutMdSetPasskeyPrologueRequest`, `WASmaxMdSetPasskeyPrologueRPC`.

## 4. GetPasskeyRequestOptions IQ (fallback)

Usado quando a notificação não embute o blob. Retorna o mesmo
`passkey_request_options` (bytes 1..4096) dentro de um `<iq type="result">`.

Fonte: `WASmaxInMdGetPasskeyRequestOptionsResponseSuccess`.

## 5. ProloguePayload (protobuf — já existe no whatsmeow)

`proto/waCompanionReg/WACompanionReg.proto`:

```proto
message CompanionEphemeralIdentity {
  optional bytes publicKey = 1;
  optional DeviceProps.PlatformType deviceType = 2;
  optional string ref = 3;
}
message CompanionCommitment { optional bytes hash = 1; }
message ProloguePayload {
  optional bytes companionEphemeralIdentity = 1;  // CompanionEphemeralIdentity serializado
  optional CompanionCommitment commitment = 2;
}
```

`initializeShortcakeLinking(ref, platformType)` monta isso:
- `companionEphemeralIdentity.publicKey` = chave efêmera/identidade do companion.
- `companionEphemeralIdentity.ref` = o `ref` da §2.
- `companionEphemeralIdentity.deviceType` = platformType (ex.: `CHROME`).
- `commitment.hash` = hash de compromisso. **Algoritmo exato vive em módulo lazy
  (não capturado)** — precisa de captura ao vivo. ⚠️ BLOQUEIO PARCIAL.

## Orquestração (cliente oficial, `g()`)

```
1. options = RequestOptionsCache.getRequestOptions()         // §1/§4
2. {assertionJson, credentialId} = webauthnCeremony(options) // navigator.credentials.get
3. ref = GetRef()                                            // §2
4. prologuePayload = initializeShortcakeLinking(ref, platform)// §5
5. [handoffProof = computePairingHandoffProof(...)]          // opcional
6. SetPasskeyPrologue(credentialId, assertionJson, prologuePayload, [handoffProof]) // §3
```

## Crypto (recuperado do módulo `WAWebShortcakeLinkingAlgorithm`)

- **commitment.hash** = `SHA256(companionEphemeralIdentityBytes || companionNonce)`
- **companion ephemeral keypair** = Curve25519; `companionNonce` = 32 bytes aleatórios
- **verificationCode** = `Crockford(primaryNonce[:5] XOR SHA256(companionNonce || primaryPublicKey)[:5])`
- **encryptionKey** = `HKDF-SHA256(IKM=X25519(companionPriv, primaryPub),`
  `salt="Companion Pairing {deviceType} with ref {ref}", info="Pairing Information Encryption Key", L=32)`
- **EncryptedPairingRequest** = `AES-256-GCM(key=encryptionKey, iv=rand(12), plaintext=PairingRequest)`
- **pairingHandoffProof** (opcional) = `HMAC-SHA256(HKDF(priorAttemptSecret,"shortcake-passkey-handoff-v1",32), data)`

### Fase 2 — IQs
- `SetCompanionNonce`: `<iq set md><companion_nonce>{bytes}</companion_nonce></iq>`
- notificação `crsc_continuation`: `<notification type="crsc_continuation"><primary_ephemeral_identity>{PrimaryEphemeralIdentity}</primary_ephemeral_identity></notification>`
- `SetEncryptedPairingRequest`: `<iq set md><encrypted_pairing_request>{EncryptedPairingRequest}</encrypted_pairing_request></iq>`

## Estado da implementação (passkey.go)

✅ Implementado e testado: IQs (GetRef, options, SetPasskeyPrologue, CompanionNonce,
EncryptedPairingRequest), ProloguePayload + commitment, verificationCode, encryptionKey,
cifragem do PairingRequest, handler das duas fases, evento `ShortcakeVerificationCode`.

Residual:
1. **Credencial/chave privada WebAuthn** sob `whatsapp.com` — blocker fundamental da #1185.
   Entra pela interface `PasskeyAuthenticator.GetAssertion`. Sem um authenticator que detenha
   a credencial (ex.: virtual FIDO), não há assertion válida — nenhum código resolve isto.
2. **Ordem/confirmação da fase 2** (enviar `encrypted_pairing_request` antes/depois da
   confirmação humana do código) — implementado como envio direto; pode precisar de 1 teste
   ao vivo pra confirmar o momento exato.
3. **Formato do blob `passkey_request_options`** — opaco; repassado direto ao authenticator,
   então não afeta o plumbing.
