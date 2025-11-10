# 和女生聊天时能像GalGame一样有选项和字幕的神人应用
有GalGame玩家反映和女生说话时不会弹出字幕与对话框，针对这种症状开发了这个APP

<img width="2834" height="1641" alt="image" src="https://github.com/user-attachments/assets/d6c44e31-8362-4825-9d7c-a760a4720133" />


作为整活向APP，目前没有接入AI，可以离线运行

### 画面卡顿是为了复刻GalGame切换CG的效果，可以手动调整更新速度或者切换成流畅的普通画面

APP在[tag](https://github.com/JStone2934/LiveGalGame/tags)中可以直接下载，报毒是正常状况，请放心使用
 

## 使用教程

- 点击齿轮按钮可以设置触发弹窗的关键词
- SAVE和Q.SAVE可以保存当前截屏到手机
- 好感度条会随着时间慢慢减少，有语音的时候会不断提高，选择不同的弹窗选项也会影响好感度
- 点击快进可以调整CG效果画面的更新速度
- 点击跳过可以把画面更新切换成实时的

### B站视频:[【-修复了GalGame玩家和女生聊天没有字幕的Bug-】](https://www.bilibili.com/video/BV15Q1jBQEzq/?share_source=copy_web&vd_source=181e7acfd50ad37dbfacd601ca302c13)
<img width="2533" height="1427" alt="image" src="https://github.com/user-attachments/assets/65dd6c6f-bf47-4bc0-9695-034c7faa290d" />


现在的软件在[tag](https://github.com/JStone2934/LiveGalGame/tags)下，功能更完整的版本会后续发布

CSDN下载链接：https://download.csdn.net/download/qq_63533710/92237453

网盘链接：通过网盘分享的文件：LiveGG
链接: https://pan.baidu.com/s/1Bpt2DZNvjzT6BpKr8RyG-A?pwd=94g6 提取码: 94g6 

## 本地构建指南

1) 前提条件

- JDK：17+

- Android SDK：36+

- Gradle：仓库内包含 `gradlew.bat` 与 gradle wrapper（Gradle 8.13），无需系统级安装 Gradle，使用仓库自带 wrapper 即可。

2) 常用构建命令（在项目根目录，PowerShell）

- 查看 Gradle wrapper 版本：

	.\\gradlew.bat --version

- 构建 Debug APK：

	.\\gradlew.bat assembleDebug

- 构建 Release APK（注意：若没有 `signing.properties` 则生成非签名的 release 包）：

	.\\gradlew.bat assembleRelease

3) 签名

项目 `app/build.gradle.kts` 会在根目录查找 `signing.properties`（若存在则读取签名信息）。如果你要生成已签名的 release 包，创建一个 `signing.properties` 文件放在项目根，例如：

	keystore.path=release.keystore
	keystore.password=your_store_password
	key.alias=your_key_alias
	key.password=your_key_password

并把 `release.keystore` 放在合适位置（与 `signing.properties` 中 path 对应）。请妥善保管密钥与密码。



## Star

[![Star History Chart](https://api.star-history.com/svg?repos=JStone2934/LiveGalGame&type=Date)](https://star-history.com/#JStone2934/LiveGalGame&Date)


## 欢迎自由开发，有活你就直接往里加
