# Limana Yanaş — İTÜ GMK kayıt oyunu

Tarayıcıda çalışan, tek dosyalık bir mobil oyun. Hikâye modunda 25 saniye dayanıp limana yanaşan oyuncu
şişedeki kayıt linkine ulaşır; kayıttan sonra sınırsız mod ve ödüllü sıralama açılır.

## Dosyalar
| Dosya | Ne işe yarar |
|---|---|
| `index.html` | Oyunun tamamı (HTML + CSS + JavaScript, logo dahil). GitHub Pages bunu yayınlar. |
| `sunucu/siralama-sunucusu.gs` | Google Apps Script sıralama sunucusu. Google Tablo'ya yapıştırılır, GitHub'da sadece yedek olarak durur. |
| `.nojekyll` | GitHub Pages'in dosyaları olduğu gibi yayınlaması için. |

## Ayarlar
`index.html` içinde en üstteki `CONFIG` bölümü:
- `REGISTRATION_URL` — kayıt formu linki
- `LEADERBOARD_URL` — Apps Script web uygulaması linki (…/exec)
- `PRIZE_TEXT`, `SEASON_END` — sıralama ekranındaki ödül metni

## Yönetici: skor doğrulama
Oyun adresinin sonuna `#tekrar` ekleyip aç, Google Tablo'daki "Tekrar kodu" hücrelerini yapıştır, **Doğrula**'ya bas.

## Önemli
Oyun kuralları (hız, zorluk, etkinlikler) değişirse `GAME_VER` artırılmalı; eski tekrar kodları o sürüme aittir.
Sunucudaki `GAME_VER` de aynı olmalı.

Canlı adres: https://kertoxo.github.io/limana-yanas/
