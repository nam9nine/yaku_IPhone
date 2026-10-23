## 변경 결과

<!-- 해결한 문제와 최종 동작을 적습니다. 제목은 영문 prefix + 한국어 설명을 사용합니다. -->

Closes #

## 검증과 제한

<!-- 실제 실행한 명령·결과, 환경, 남은 제한을 적습니다. 실패·미실행은 성공과 구분합니다. UI 변경은 실제 캡처와 비교 결과를 포함합니다. -->

## 독립 검토

<!-- 구현을 맡지 않은 검토자의 식별자, 확인한 diff·완료 조건·화면 범위, 지적과 처리 결과를 적습니다. 같은 계정의 에이전트 검토를 별도 GitHub 계정의 승인으로 표현하지 않습니다. -->

## 하네스 증거

<!-- 아래는 의도적으로 미완료 값입니다. 실제 검토 후 현재 head 전체 SHA, 위 Issue 번호, 관찰한 결과로 채웁니다. docs/harness.md를 따릅니다. -->
<!-- environment와 실제 checks 결과를 채웁니다. npm run check pass는 필수이며 UI 변경은 test:e2e·test:visual pass도 필요합니다. UI 변경은 visual.status pass와 scenes·추적 이미지·reference·comparison이 필수입니다. UI 무관 변경만 not-applicable과 구체적인 reason을 쓸 수 있습니다. baseline 변경 시 baselineChanged를 true로 바꾸고 baselineReview {reviewer, verdict, summary}를 추가합니다. -->

<!-- harness-evidence -->

```json
{
  "schemaVersion": 1,
  "headSha": "",
  "issue": 0,
  "environment": {
    "platform": "",
    "node": "",
    "playwright": ""
  },
  "checks": [
    {
      "command": "npm run check",
      "result": "not-run",
      "details": ""
    },
    {
      "command": "npm run test:e2e",
      "result": "not-run",
      "details": ""
    },
    {
      "command": "npm run test:visual",
      "result": "not-run",
      "details": ""
    }
  ],
  "review": {
    "reviewer": "",
    "verdict": "pending",
    "summary": ""
  },
  "visual": {
    "status": "pending",
    "reason": "",
    "scenes": [],
    "references": [],
    "artifacts": [],
    "comparison": "",
    "baselineChanged": false
  }
}
```

<!-- /harness-evidence -->
