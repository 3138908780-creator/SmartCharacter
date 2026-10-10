# 第三方组件与素材声明

SC 自有内容由 **Super potato** 按根目录 [LICENSE](LICENSE) 授权。第三方字体、库、模型和工具由其原权利人按原许可证独立授权；SC 禁止软件商业利用和独立再分发的条款不缩减这些第三方许可证授予的权利。授权咨询：[3138908780@qq.com](mailto:3138908780@qq.com)。

这里提供当前源码对应的声明、原文入口和来源索引。源码候选不包含 node_modules 或本地运行组件二进制。后续按系统交付安装资源时，须以实际交付的文件补齐原声明、覆盖源码及构建记录；当前声明不代表三平台安装资源已验收。

## 随源码提供的字体和素材

13 个字体文件、10 个家族按 SIL Open Font License 1.1 原样提供，原版权和完整 OFL 位于 [字体许可目录](public/fonts/licenses/README.md)。逐文件版本、来源、许可和 SHA256 见 [素材索引](licenses/assets.json)。包括 Noto Sans/Serif CJK SC、LXGW WenKai、Smiley Sans、Douyin Sans、Ma Shan Zheng、Long Cang、Liu Jian Mao Cao、Zhi Mang Xing 与 Tiejili SC。

字体的原权利人及保留字体名要求继续有效。SC 不将字体改为自有许可；使用字体制作的输出作品不因此自动适用字体软件许可。字体单独售卖、修改和再分发的条件以各自 OFL 为准。[OFL FAQ](https://openfontlicense.org/ofl-faq/)

SC 图标是本项目新绘制的几何字母图形；黑板背景由项目权利人委托 GPT 生成。详细记录见 [素材来源](ASSET_PROVENANCE.md)。未随候选提供参考作品的原视频、原音乐或私人素材；音效名称记录不意味着包含相应音频或取得第三方音频授权。

## npm 组件

| 运行依赖 | 锁定版本 | 顶层许可 | 原文本 |
| --- | --- | --- | --- |
| @napi-rs/canvas | 1.0.9 | MIT，内含原生第三方代码另按其许可 | [LICENSE](licenses/npm/@napi-rs__canvas@1.0.9/LICENSE) |
| busboy | 1.6.0 | MIT | [LICENSE](licenses/npm/busboy@1.6.0/LICENSE) |
| pinyin-pro | 3.29.4 | MIT | [LICENSE](licenses/npm/pinyin-pro@3.29.4/LICENSE) |
| react | 19.2.6 | MIT | [LICENSE](licenses/npm/react@19.2.6/LICENSE) |
| react-dom | 19.2.6 | MIT | [LICENSE](licenses/npm/react-dom@19.2.6/LICENSE) |

16 项直接开发依赖和传递依赖见 [npm 全量索引](licenses/npm/README.md)；锁中的 409 条记录包含重复版本和未安装的平台可选包，不等于实际捆绑组件数量。完整版本、下载来源、integrity、许可标签和可取得的原声明文件哈希见 [npm inventory](licenses/npm-inventory.json)。

本机安装的 317 个锁条目均保留对应包内声明、共同项目原声明或 README 许可章节。未安装的 92 条记录按锁元数据和归档来源列入索引，未将它们的声明标为已核对实物。实际交付包需保留包内完整 LICENSE、NOTICE、第三方版权和适用附加文件，不能只依据索引的顶层标签。

`busboy` 与 `streamsearch` 锁元数据缺少 license 字段，但实际包内 LICENSE 是 MIT；本索引据实物说明，不改其原包元数据。TypeScript 使用 Apache 2.0，其 [ThirdPartyNoticeText](licenses/npm/typescript@5.9.3/ThirdPartyNoticeText.txt) 一并保留。Vite、rolldown 等包的许可文件包含附带组件声明，不能简化为仅一行 MIT。

MPL 2.0 项包括 axe-core、lightningcss 及其相关平台包。若向外交付相关代码或压缩、编译产物，应提供适用覆盖源码的取得方式及原声明；SC 的软件再分发限制不覆盖这些第三方源码。[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

`caniuse-lite` 的数据标为 CC BY 4.0，原声明和署名保留在对应目录。`language-subtag-registry` 的数据按 CC0，其他 Python 2.0、BlueOak、BSD、ISC、Apache、MIT 等内容也独立按原文授权。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)、[CC0](https://creativecommons.org/publicdomain/zero/1.0/legalcode)、[BlueOak](https://blueoakcouncil.org/license/1.0.0)

## Canvas 和 Skia 原生第三方代码

现有 Canvas 1.0.9 / Skia `a9c42c9fce77cd748805df0ec67ef5718800b1e9` 的 106 项来源记录和 225 个清单文件保留在 [resources/native-notices](resources/native-notices/sources.json)。可阅读的原许可入口和对应源码来源见 [原生组件索引](licenses/native/README.md)。这些原文件未删改，包括版权、PATENTS、FTL、IJG 和附带子目录声明。

其中 cssparser 0.38.0、cssparser-color 0.6.0、cssparser-macros 0.7.0、dtoa-short 0.3.5 为 MPL 2.0。其确切源码归档地址和哈希已记录，受覆盖源码可从对应索引的来源取得。若修改受覆盖文件，交付相应二进制时应使接收者可取得修改后的覆盖源码。MPL 仅适用于其覆盖范围，不重新许可 SC 的全部自有代码。

该声明集合包含构建工具和不同子组件。后续各平台的实际原生包与链接内容仍须按交付版本核对，不能把 Canvas 顶层 MIT 当成所有内含代码的统一许可证。

## 本地运行工具及模型

三平台实际准备的 Node、Python、Pillow、FFmpeg、Whisper 与模型原许可见 [运行组件目录](licenses/runtime/README.md)，精确来源和声明哈希见 [runtime inventory](licenses/runtime-inventory.json)。纯源码不带组件二进制；完整候选在独立组件归档内带相同声明及源码资料。运行状态以实机验收表为准。

- Node 24.14.0：各目标官方完整 LICENSE 及内含依赖声明单独保留。
- Python / Pillow：保留固定发行和 wheel 内原许可；pip 和库的原文件同样在完整包内，不以 SC 许可替代。
- FFmpeg / ffprobe 9.0.2：独立进程调用；三目标均关闭 GPL、nonfree 和 version3、关闭额外库自动探测。精确源码归档和构建参数随资源提供，Windows 另带交叉编译运行库源文件和 MinGW / LLVM 原声明。接收者可按 LGPL 取得源码、修改、重建或替换工具。[FFmpeg 许可说明](https://ffmpeg.org/legal.html)
- Whisper 1.9.5 与固定 base-q5_1 模型：分别保留 MIT；Windows 实际为同一源码的静态 CPU 构建，官方 b5454 归档只作为记录中的核对参考。
- Windows OpenCV 4.13.0.92、NumPy 2.2.6 和 YuNet：保留完整 wheel / 库 / 模型原声明。NumPy 内 OpenBLAS、LAPACK、GCC runtime 及其例外分别独立适用。Microsoft 原 DLL 和原运行库条款同时保留。OpenCV 只用于静帧 YuNet；其未使用的视频 FFmpeg 插件不随运行包交付，原声明不删减。
- Mac 人脸辅助程序：SC 自有 Swift 代码按根 LICENSE；系统 Vision 框架由 macOS 提供，不复制系统框架发布。

官方来源：[Node](https://github.com/nodejs/node/blob/main/LICENSE)、[CPython](https://github.com/python/cpython/blob/main/LICENSE)、[Pillow](https://github.com/python-pillow/Pillow/blob/main/LICENSE)、[whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)、[Whisper 模型](https://raw.githubusercontent.com/openai/whisper/main/LICENSE)、[OpenCV Python](https://github.com/opencv/opencv-python/blob/master/LICENSE-3RD-PARTY.txt)、[YuNet](https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/LICENSE)。

## 远程服务和用户内容

AI 提供商的服务、账号、模型和费用按其自己的条款处理。SC 仅提供可选客户端连接逻辑；本候选不交付提供商私有模型、服务端程序、私人密钥或账号权益。软件自有许可不会替代第三方 API 服务条款。

用户输入的视频、SRT、工程和其他素材不因使用 SC 而成为 SC 自有内容，也不随源码发布。公开声明中原有第三方作者姓名和联系信息是其版权记录；SC 的公开署名和授权邮箱则由项目权利人明确提供。
