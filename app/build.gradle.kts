plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val vioraApiBaseUrl = providers.environmentVariable("VIORA_API_BASE_URL").orElse("").get()
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

android {
    namespace = "com.prempk.viora"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prempk.viora"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "VIORA_API_BASE_URL", "\"$vioraApiBaseUrl\"")
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

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
