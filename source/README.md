# ShowMe AI – web version (Vercel + Supabase)

```
public/index.html          the app (sign-in, chat, admin)
public/android-test.html   same interface, NO Google button, fake login + sample AI replies (for checking Android)
api/                       Vercel functions: chat (AI proxy), me, admin, config
supabase/schema.sql        3 tables (admins, knowledge, app_settings) – run once
test/                      node test/api.test.js  (backend checks, no network needed)
```

## 1. Supabase (about 10 min)
1. Create a project at supabase.com.
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **Authentication → Sign In / Providers → Google**: enable it and paste your Google OAuth *Client ID / Secret*
   (Google Cloud Console → APIs & Services → Credentials → OAuth client, type *Web*).
   Add the redirect URI shown by Supabase (`https://<ref>.supabase.co/auth/v1/callback`) to that Google client.
4. **Authentication → URL Configuration**: *Site URL* = your Vercel address (e.g. `https://showme.vercel.app`) and add
   `https://showme.vercel.app/**` to *Redirect URLs*.
5. **Authentication → Sign In / Providers → Email**: keep **Confirm email = ON**.
   This is what stops a stranger registering `mishtiaqkhursheed@gmail.com` with their own password. The server also
   refuses any account whose e-mail is not confirmed, but do not turn this setting off.
6. **Settings → API Keys**: copy the *Publishable* key (`sb_publishable_...`) and the *Secret* key (`sb_secret_...`).
   (Legacy `anon` / `service_role` keys also work.)

## 2. Vercel
1. Put this folder in a GitHub repo, then Vercel → *Add New Project* → import it (Framework: **Other**, no build command).
2. *Settings → Environment Variables*:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | publishable key (safe for browsers) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** key – never put it in the HTML |
| `ZHIPU_API_KEY` | optional – you can paste the key later in Admin instead |
| `OWNER_EMAIL` | optional – defaults to `mishtiaqkhursheed@gmail.com` |

3. Deploy. Open the site, sign in with the owner e-mail → open the small gear button (top-left) → **Settings**; the Admin and Library entries appear there.

## 3. Who can do what
| | Normal user | Added admin | Owner |
|---|---|---|---|
| Chat with the AI | yes | yes | yes |
| Settings → Admin / Library, AI key, Knowledge import | no | yes | yes |
| Add / remove admin e-mails | no | no | yes |

* The owner e-mail is fixed (`OWNER_EMAIL`) and can never be removed.
* The buttons are hidden for others, **and** the server checks the verified e-mail on every request.
* A person you add must sign in with that exact e-mail (Google or e-mail + password).

## Notes
* Chats are stored in the browser, separately for each signed-in user (not synced between devices).
* Anyone can create an account. To limit sign-ups, turn off "Allow new users to sign up" in Supabase
  (Authentication → Sign In / Providers) once your people are registered.
* Knowledge data is stored in Supabase and added to the prompt on the server in *Think* mode; users never download it.
* Long answers can take up to 5 minutes (Vercel limit); `vercel.json` already asks for that.
* Local development: `npm i -g vercel`, then `vercel dev` (needs the same variables in a `.env` file).
