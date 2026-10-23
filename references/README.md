# 로컬 레퍼런스

[manifest.json](manifest.json)이 출처·정확한 커밋·확인일·라이선스·용도·주요 파일·다운로드 주소·SHA-256의 색인입니다. 원문은 로컬 `upstream/`에만 보관하며 Git과 공개 앱 빌드에서 제외합니다. 보존한 코드 라이선스는 `licenses/`에 있습니다.

```sh
npm run refs:fetch
npm run refs:fetch -- --verify-only
npm run refs:fetch -- --extract
```

기본 명령은 누락 자료를 다운로드하고 기존 자료의 해시를 확인합니다. `--verify-only`는 네트워크 없이 원문을 확인합니다. `--extract`는 고정된 전체 아카이브를 `upstream/sources/`에 안전하게 풀어 읽을 수 있게 합니다. 외부 프로젝트 설치나 코드는 실행하지 않습니다. 원문이 바뀌거나 기존 파일이 수정되면 자동 덮어쓰기 대신 오류를 반환합니다.

현재 보관 대상은 macos-portfolio, BymanOS, ios27-design-system, liquidframe, liquid-glass-react, 사용자가 제시한 chajuhann 사이트 및 Apple 공식 화면·문서입니다. 다섯 코드 저장소의 MIT LICENSE와 Apple·원본 사이트의 자료 이용 범위는 구분합니다. Apple 이미지는 로컬 시각 참고용이며 앱 자산으로 옮기지 않습니다.

이 기반 작업에서는 외부 구현 코드를 앱에 채택하지 않았습니다. 앞으로 채택할 때에는 필요한 파일만 앱 소스로 옮기고 출처·라이선스를 기록합니다. 자세한 활용 기준은 [레퍼런스 문서](../docs/references.md)를 따릅니다.
