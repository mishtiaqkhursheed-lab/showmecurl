
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.showme.ai"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.showme.ai"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    // Chrome Custom Tabs – opens Google OAuth in the external browser
    implementation("androidx.browser:browser:1.8.0")
}
