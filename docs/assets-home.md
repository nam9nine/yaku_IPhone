# 홈 화면 자산

`public/widgets/mountain.png`는 2026-10-23에 기본 내장 `image_gen` 도구로 생성한 프로젝트용 풍경 이미지다. Apple 공식 사진을 복사하지 않았다. 생성 결과를 직접 열어 바위 능선, 푸른 하늘, 인물·문자·로고가 없는 것을 확인했으며 원본 출력을 편집 없이 프로젝트로 복사했다. 표시할 때 정사각형 위젯 안에서 `object-fit: cover`를 사용한다.

원본 보관 위치: `/Users/namgyu/.codex/generated_images/01a1681f-ca83-7b40-bc6a-27fa01a9279e/exec-130d0047-e7b6-4d2a-ad27-f81537df8129.png`.

사용한 최종 프롬프트:

> Use case: photorealistic-natural. Asset type: square mobile photo widget, 1024×1024. Primary request: an original landscape photograph composition with a sunlit granite ridge in the foreground, layered alpine mountains receding behind it, and a clear blue sky. Warm late afternoon light, crisp natural rock textures, restrained realistic colors, natural outdoor photography. No people, text, logo, watermark, frame, or UI. This image should be a single landscape photograph that reads clearly when cropped into a small square widget.

`src/home/AppIcon.tsx`의 앱 아이콘은 프로젝트에서 직접 작성한 SVG/CSS다. 공식 홈 화면의 앱 구분·색상·배치 원칙을 참고했지만 Apple의 원본 아이콘 파일·경로·코드를 가져오지 않았다. 실제 앱 또는 운영체제 기능을 제공하지 않으며 아이콘 선택 시 준비 중 안내를 표시한다.
