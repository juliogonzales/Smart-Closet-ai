# Publicar o app no GitHub Pages (passo a passo pelo celular)

Endereço final: **https://juliogonzales.github.io/Smart-Closet-ai/**

## 1. Enviar os arquivos
1. Abra `github.com/juliogonzales/Smart-Closet-ai` no navegador (ative "Versão para computador").
2. Envie o conteúdo do zip para a raiz do repositório, na branch `main`:
   - Pelo botão **Add file > Upload files**, ou
   - Substituindo arquivo por arquivo (abra o arquivo, toque no lápis e cole o conteúdo).
3. Não apague nem altere `js/config.js`.
4. Confirme que existem `index.html`, `js/app.js`, `sw.js`, `manifest.webmanifest`, `icons/icon.svg` e `.nojekyll`.
5. Toque em **Commit changes** > **Commit directly to main**.

## 2. Ativar o GitHub Pages
1. No repositório, toque em **Settings** (o último item da barra de abas; se não aparecer, toque nos três pontos).
2. No menu lateral, toque em **Pages**.
3. Em **Build and deployment > Source**, escolha **Deploy from a branch**.
4. Em **Branch**, escolha **main** e a pasta **/ (root)**. Toque em **Save**.
5. Espere 1 a 2 minutos e recarregue a página. Vai aparecer "Your site is live at…".

## 3. Conferir
1. Abra o endereço acima no navegador (não pelo ícone do app).
2. Entre na conta e abra `#/diagnostico`. Cada item deve mostrar OK.
3. Se o site mostrar "Sem conexão" ou a tela não carregar, espere 5 minutos e atualize sem cache.

## 4. Atualizações futuras
Cada commit na `main` republica o site automaticamente. Se o app parecer antigo, feche as abas, espere alguns minutos e recarregue pelo navegador. Se estiver instalado na tela inicial, remova e instale de novo.

## 5. Endereço do site no Supabase
Em **Authentication > URL Configuration**, o *Site URL* e os *Redirect URLs* devem ser exatamente `https://juliogonzales.github.io/Smart-Closet-ai/`. Sem isso, o link de confirmação de e-mail e a recuperação de senha não funcionam.
