plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "blue.fat.fish"
    compileSdk = 36

    defaultConfig {
        applicationId = "blue.fat.fish"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
    }

    // release 签名：项目根 bluefatfish 密钥库（PKCS12，全部字段 = bluefatfish，30 年有效期）
    signingConfigs {
        create("release") {
            storeFile = rootProject.file("bluefatfish")
            storePassword = "bluefatfish"
            keyAlias = "bluefatfish"
            keyPassword = "bluefatfish"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    // 素材直存不压缩：webm 已是高压缩 VP9，ttf 二进制 —— 保持 mmap 友好、包体最小
    androidResources {
        noCompress.addAll(listOf("webm", "ttf"))
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}

dependencies {
    // WebViewAssetLoader：把 https://appassets.androidplatform.net/assets/* 映射到 APK assets，
    // renderer 的 https 形态 URL（fetch/video/font）零改动可跑，且无 CORS 烦恼
    implementation("androidx.webkit:webkit:1.12.1")
}
