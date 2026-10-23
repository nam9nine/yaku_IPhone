# Chromium 터치 검사 참고 자료

2026-10-23에 확인한 입력 검증 자료다. 원문은 ignored `references/upstream/runtime/`에 보관하며 앱 코드로 채택하지 않는다. 로컬 조사 참고만 하며 각 원문의 저작권·라이선스를 변경하지 않는다.

| 자료                                                                                                                                           | 버전·목적                                                | 로컬 원문                                                     | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Aura 제스처 설정](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/ui/events/gesture_detection/gesture_configuration_aura.cc) | 156.0.8078.4; Linux fling tap suppression 기본 설정      | `upstream/runtime/chromium-156-gesture-configuration-aura.cc` | `533c1aa9189bcade4d3db7b57d8ec7ba743f93ee17e30e987622e31ada92f607` |
| [Chromium 입력 처리](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/components/input/input_router_impl.cc)                   | 156.0.8078.4; fling 처리와 touch-action 필터 순서        | `upstream/runtime/chromium-156-input-router.cc`               | `dda0a74aaf392af1bf7ae2dbb4801c07c8afc65817618174d2982678ccfa120d` |
| [CDP Input 정의](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl)                              | 2026-10-23 snapshot; native touch·속도·preventFling 계약 | `upstream/runtime/cdp-input.pdl`                              | `5bbc6e23eb17a009da540792bd5f647567e9c81f919081059dff5274a1c66e3d` |

`Input.synthesizeScrollGesture`는 실제 브라우저 터치 이벤트를 생성한다. 세로 이동 금지 검사에서는 `gestureSourceType: touch`, `speed: 600`, `preventFling: true`로 드래그가 멈춘 후 다음 탭을 검사한다. 빠른 flick·홈·최근 앱 전환은 기존 제스처 검사로 별도 확인한다. 브라우저의 내부 fling trace를 관찰하지 않았으므로 Linux 실패의 원인을 소스만으로 확정하지 않는다.
