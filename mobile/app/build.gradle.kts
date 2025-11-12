import java.util.Properties
import java.io.FileInputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.jstone.livegalgame"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.jstone.livegalgame"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.8.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // 在这里添加 signingConfigs 整个代码块 
    signingConfigs {
        val keystorePropsFile = rootProject.file("signing.properties")
        if (keystorePropsFile.exists()) {
            create("release") {
                val props = Properties().apply {
                    FileInputStream(keystorePropsFile).use { load(it) }
                }
                storeFile = rootProject.file(props.getProperty("keystore.path") ?: "release.keystore")
                storePassword = props.getProperty("keystore.password")
                keyAlias = props.getProperty("key.alias")
                keyPassword = props.getProperty("key.password")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )

            // 检查 "release" 签名配置是否真的被创建了
            // （只在 "发布" 工作流中才会创建）
            if (signingConfigs.findByName("release") != null) {
                // 如果存在，才去使用它
                signingConfig = signingConfigs.getByName("release")
            }
            // 如果不存在（在 "检查" 工作流中），
            // 这个 if 语句会跳过，构建将继续（生成一个未签名的 release 包）
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    // Vosk dependency
    implementation("com.alphacephei:vosk-android:0.3.32")
    implementation("net.java.dev.jna:jna:5.14.0@aar")

    // CameraX dependencies
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}