# V1 MyReader — GitHub Pages

Target:
`https://asjwd.github.io/myreader/`

## Upload ke repository `asjwd/myreader`

Upload isi folder ini ke root branch yang dipakai GitHub Pages:

- `index.html`
- `articles.html`
- `books.html`
- `manuscripts.html`
- `gas-shim.js`

Lalu aktifkan **Settings → Pages → Deploy from a branch → root**.

## Backend

`gas-shim.js` sudah menunjuk ke deployment Apps Script:

`https://script.google.com/macros/s/AKfycbxgaIy-w6LFAozSefIOpwDx8pnfVSVZ_QdXkVLwuY9OJJiT9Brpl3bpihzM_zd-PiOmog/exec`

Jangan menaruh `LIBRARY_ACCESS_KEY`, token perangkat, password pairing, OTP, BOT_TOKEN, atau secret lain di repository GitHub.

## Login V1

V1 memakai mekanisme trusted-device yang sudah ada:

1. Perangkat baru memasukkan device authorization password.
2. OTP 5 digit dikirim ke email owner.
3. Setelah berhasil, device token disimpan di `localStorage` browser.
4. Reload/kunjungan berikutnya menggunakan token tersebut.
5. Revoke menghapus akses perangkat dan token lokal.

V1 belum menambahkan passkey/fingerprint biometrik. Fingerprint pada kode lama adalah browser/device fingerprint, bukan sidik jari biologis.

## Data

GitHub hanya menyimpan frontend. Books, Articles, Manuscripts, annotations, highlights, PDF, dan project data tetap di Google Sheets/Drive melalui Apps Script.
