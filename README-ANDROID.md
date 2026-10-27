# ShowMe Android app project

This is an Android Studio project wrapping the supplied ShowMe interface. It includes a local HTML asset so the chat UI and locally saved guest chats can open without a connection. AI generation, sign-in, admin tools, and cloud data still require your deployed backend and internet.

## Before running

1. Open this folder in Android Studio (Hedgehog or newer) and allow Gradle sync.
2. In `app/src/main/res/values/strings.xml`, set `showme_api_base_url` to the deployed origin for your existing ShowMe Vercel project, without a trailing slash, for example `https://your-project.vercel.app`.
3. Set `google_web_client_id` to the **Web application OAuth client ID** configured in your Supabase Google provider. It must be the same client ID Supabase expects for Google ID-token sign-in.
4. In Google Cloud Console, configure the OAuth consent screen and the client ID; in Supabase, enable Google provider. Ensure the provider accepts ID-token sign-in for this client.
5. Build and run on an Android device with Google Play services.

## Offline behaviour

- The app opens your deployed ShowMe site inside the app. If the site cannot load, it falls back to the bundled `public/index.html` instead of requiring a browser.
- When the site cannot be reached, the Android build opens local guest/offline mode and stores guest chats in WebView local storage.
- Sending a message while offline displays the existing ShowMe connection-error response in the chat. AI responses cannot be generated offline by Groq.
- Google sign-in uses Android Credential Manager and passes the ID token to Supabase from inside the app; it does not intentionally launch a browser.

## Important notes

- This is the **Android Studio source project**, not a prebuilt APK. Gradle must download Android dependencies to build it.
- The project uses the existing backend. Do not put Supabase service-role keys or Groq API keys in the Android app.
- The app project has not been compiled or tested on a physical device in this environment. Review Gradle sync/build output before distributing it.
- For release distribution, change `applicationId` in `app/build.gradle.kts` to a unique ID you control and set up your signing key.
