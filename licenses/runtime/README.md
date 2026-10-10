# 三平台运行组件原许可

本目录保存本轮实际准备的三平台组件原声明。组件二进制不收入纯源码归档，完整候选的受管资源同时带有原声明、源码与构建命令。资源完整性和目标机运行验收分开记录，见根目录三平台实机验收表。

| 目标 | 组件 | 版本 | 原许可 |
| --- | --- | --- | --- |
| darwin-arm64 | python | 3.12.15+20261003 | [Python-2.0/CNRI and dependencies; included original notices](darwin-arm64/python/licenses/python/LICENSE.bdb.txt) |
| darwin-arm64 | pillow | 11.3.0 | [wheel includes all dependency license notices](darwin-arm64/pillow/python/lib/python3.12/site-packages/pillow-11.3.0.dist-info/licenses/LICENSE) |
| darwin-arm64 | whisperModel | base-q5_1@5359861c739e955e79d9a303bcbc70fb988958b1 | [MIT](darwin-arm64/whisperModel/licenses/whisper/model-MIT.txt) |
| darwin-arm64 | ffmpeg | 9.0.2 | [LGPL-2.1-or-later (GPL/nonfree/version3 disabled)](darwin-arm64/ffmpeg/licenses/ffmpeg/LGPL-2.1.txt) |
| darwin-arm64 | whisper | 1.9.5 | [MIT](darwin-arm64/whisper/licenses/whisper/whisper-cpp-MIT.txt) |
| darwin-arm64 | faceDetector | d1f3073 packaging adapter | [SC public source license 1.0](darwin-arm64/faceDetector/licenses/SC-local-candidate.txt) |
| darwin-arm64 | node | 24.14.0 | [Node and bundled original LICENSE](darwin-arm64/node/LICENSE) |
| darwin-x64 | python | 3.12.15+20261003 | [Python-2.0/CNRI and dependencies; included original notices](darwin-x64/python/licenses/python/LICENSE.bdb.txt) |
| darwin-x64 | pillow | 11.3.0 | [wheel includes all dependency license notices](darwin-x64/pillow/python/lib/python3.12/site-packages/pillow-11.3.0.dist-info/licenses/LICENSE) |
| darwin-x64 | whisperModel | base-q5_1@5359861c739e955e79d9a303bcbc70fb988958b1 | [MIT](darwin-x64/whisperModel/licenses/whisper/model-MIT.txt) |
| darwin-x64 | ffmpeg | 9.0.2 | [LGPL-2.1-or-later (GPL/nonfree/version3 disabled)](darwin-x64/ffmpeg/licenses/ffmpeg/LGPL-2.1.txt) |
| darwin-x64 | whisper | 1.9.5 | [MIT](darwin-x64/whisper/licenses/whisper/whisper-cpp-MIT.txt) |
| darwin-x64 | faceDetector | d1f3073 packaging adapter | [SC public source license 1.0](darwin-x64/faceDetector/licenses/SC-local-candidate.txt) |
| darwin-x64 | node | 24.14.0 | [Node and bundled original LICENSE](darwin-x64/node/LICENSE) |
| win32-x64 | python | 3.12.15+20261003 | [Python-2.0/CNRI and dependencies; included original notices](win32-x64/python/licenses/python/LICENSE.bdb.txt) |
| win32-x64 | pillow | 11.3.0 | [wheel includes all dependency license notices](win32-x64/pillow/python/Lib/site-packages/pillow-11.3.0.dist-info/licenses/LICENSE) |
| win32-x64 | numpy | 2.2.6 | [wheel includes all dependency license notices](win32-x64/numpy/python/Lib/site-packages/numpy-2.2.6.dist-info/LICENSE.txt) |
| win32-x64 | opencv | 4.13.0.92 | [wheel includes all dependency license notices](win32-x64/opencv/python/Lib/site-packages/opencv_python_headless-4.13.0.92.dist-info/LICENSE-3RD-PARTY.txt) |
| win32-x64 | whisperModel | base-q5_1@5359861c739e955e79d9a303bcbc70fb988958b1 | [MIT](win32-x64/whisperModel/licenses/whisper/model-MIT.txt) |
| win32-x64 | yunetModel | 2023mar | [MIT](win32-x64/yunetModel/licenses/yunet/MIT.txt) |
| win32-x64 | ffmpeg | 9.0.2 | [LGPL-2.1-or-later; GPL/nonfree/version3 disabled](win32-x64/ffmpeg/licenses/ffmpeg/LGPL-2.1.txt) |
| win32-x64 | ffmpegToolchain | Zig 0.15.2 bundled MinGW/compiler runtime | [Included original notices](win32-x64/ffmpegToolchain/licenses/ffmpeg-toolchain/LLVM-libcxx-LICENSE.txt) |
| win32-x64 | whisper | 1.9.5 / d1be6fd / static CPU | [MIT](win32-x64/whisper/licenses/whisper/whisper-cpp-MIT.txt) |
| win32-x64 | microsoftRuntime | DLLs bundled in fixed Python/NumPy distributions | [Microsoft Visual C++ 2015-2022 Runtime terms](win32-x64/microsoftRuntime/licenses/microsoft/VC-Runtime-2015-2022-License.txt) |
| win32-x64 | node | 24.14.0 | [Node and bundled original LICENSE](win32-x64/node/LICENSE) |

各原文件的来源与 SHA256 见 [runtime inventory](../runtime-inventory.json)。已存在的 ARM 参考原文件继续保留；新清单指向本轮实际组件的完整声明。

Windows 的独立 FFmpeg 和 Whisper 使用固定源码静态 CPU 构建，不采用库繁多的 BtbN 包或需额外 VC/OpenMP 的 Whisper 参考包。对应 FFmpeg / Whisper 源码归档、编译命令及 Zig 内含运行库源文件在完整组件包的 sources 目录。原 MinGW、LLVM libc++ / libc++abi / libunwind 和 Zig 声明随包保留。

NumPy wheel 自带 OpenBLAS / LAPACK / GCC runtime 的完整许可和 GCC Runtime Library Exception；不能因含 GPL 原文而忽略相应例外，也不能将 NumPy 顶层 BSD 当成统一许可。Microsoft DLL 沿用固定 Python / NumPy 发行中的原文件，补 Microsoft 官方原运行库条款。OpenCV 原 wheel 声明完整保留，未使用的视频插件不收入运行包。
