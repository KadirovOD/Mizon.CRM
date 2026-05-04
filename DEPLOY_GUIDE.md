# Mizon CRM — Deploy Qo'llanmasi

## 🟢 Deploy holati
- **Frontend + Backend:** https://mizon-crm-kadirovods-projects.vercel.app
- **Vercel Dashboard:** https://vercel.com/kadirovods-projects/mizon-crm

---

## ⚠️ 1-qadam: Saytni ommaga ochish

Vercel Dashboard'ga kiring va Authentication'ni o'chiring:

1. Oching: https://vercel.com/kadirovods-projects/mizon-crm/settings/deployment-protection
2. **"Vercel Authentication"** → **Disabled** qiling
3. **Save** bosing

---

## 🗄️ 2-qadam: Bepul PostgreSQL bazasi (Neon)

Ma'lumotlar saqlanishi uchun bepul PostgreSQL kerak:

1. **https://neon.tech** ga kiring (GitHub bilan)
2. **"New Project"** → nom: `mizon-crm`
3. Yaratilgandan so'ng **Connection String** ni nusxalang:
   ```
   postgresql://user:password@host/dbname?sslmode=require
   ```

4. Vercel'da Environment Variable qo'shing:
   - https://vercel.com/kadirovods-projects/mizon-crm/settings/environment-variables
   - **Name:** `DATABASE_URL`
   - **Value:** (nusxalagan connection string)
   - **Environment:** Production ✓
   - **Save** bosing

5. Qayta deploy qiling:
   ```bash
   cd "/Users/kadirov_od/Documents/Mizon Odoo"
   npx vercel --yes --prod
   ```

---

## 🔑 Login ma'lumotlari
| Rol | Login | Parol |
|-----|-------|-------|
| CEO | `ceo` | `123` |
| Menejer | `menejer_1` | `123` |

---

## 🔄 Keyingi deploylar
```bash
cd "/Users/kadirov_od/Documents/Mizon Odoo"
git add -A && git commit -m "update"
npx vercel --yes --prod
```
