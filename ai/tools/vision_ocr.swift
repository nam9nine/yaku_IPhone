// JSONL stdin/stdout worker. No network or model downloads; one image at a time.
// Compile: swiftc -O ai/tools/vision_ocr.swift -o /absolute/path/vision-ocr
import Foundation
import ImageIO
import Vision

let engine: [String: Any] = [
    "name": "Apple Vision VNRecognizeTextRequest",
    "revision": 3,
    "recognition_level": "accurate",
    "recognition_languages": ["ko-KR", "en-US"],
    "uses_language_correction": false,
    "automatically_detects_language": false,
    "minimum_text_height": 0.008,
    "macos_version": ProcessInfo.processInfo.operatingSystemVersionString,
    "bounding_box_coordinates": "normalized_bottom_left",
    "maximum_decoded_pixels": 40_000_000,
]

func recognize(_ input: [String: Any]) -> [String: Any] {
    let started = Date()
    let identifier = input["image_sha256"] as? String ?? ""
    var output: [String: Any] = [
        "schema_version": 1,
        "image_sha256": identifier,
        "engine": engine,
        "training_eligible": false,
        "speaker_id": NSNull(),
        "review_status": "unreviewed",
    ]
    do {
        guard let path = input["image_path"] as? String,
              let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int
        else {
            throw NSError(domain: "CorpusOCR", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "image decode/metadata failed"])
        }
        guard width > 0, height > 0, width <= 40_000_000 / height else {
            throw NSError(domain: "CorpusOCR", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "decoded image exceeds 40 million pixels"])
        }
        let orientationRaw = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: orientationRaw) ?? .up
        let request = VNRecognizeTextRequest()
        request.revision = 3
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = false
        request.automaticallyDetectsLanguage = false
        request.minimumTextHeight = 0.008
        let supported = try request.supportedRecognitionLanguages()
        guard ["ko-KR", "en-US"].allSatisfy(supported.contains) else {
            throw NSError(domain: "CorpusOCR", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "required OCR language unavailable"])
        }
        let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path),
                                           orientation: orientation, options: [:])
        try handler.perform([request])
        let observations: [[String: Any]] = (request.results ?? []).enumerated().map { index, observation in
            let candidates: [[String: Any]] = observation.topCandidates(3).map {
                ["text": $0.string, "confidence": $0.confidence]
            }
            return [
                "observation_index": index,
                "text": candidates.first?["text"] ?? "",
                "candidates": candidates,
                "bounding_box": ["x": observation.boundingBox.minX,
                                 "y": observation.boundingBox.minY,
                                 "width": observation.boundingBox.width,
                                 "height": observation.boundingBox.height],
                "speaker_id": NSNull(),
                "training_eligible": false,
            ]
        }
        output["status"] = "success"
        output["observations"] = observations
        output["width"] = width
        output["height"] = height
        output["exif_orientation"] = orientationRaw
        output["frame_count"] = CGImageSourceGetCount(source)
        output["selected_frame_index"] = 0
        output["text_raw"] = observations.compactMap { $0["text"] as? String }.joined(separator: "\n")
        output["text_order"] = "Vision observation order; not validated dialogue order"
    } catch {
        output["status"] = "failed"
        output["error"] = String(describing: error)
    }
    output["elapsed_seconds"] = Date().timeIntervalSince(started)
    return output
}

while let line = readLine() {
    let result: [String: Any] = autoreleasepool {
        do {
            guard let input = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
                throw NSError(domain: "CorpusOCR", code: 4)
            }
            return recognize(input)
        } catch {
            return ["schema_version": 1, "status": "failed", "error": "invalid JSONL request: \(error)"]
        }
    }
    do {
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    } catch {
        FileHandle.standardOutput.write(Data("{\"status\":\"failed\",\"error\":\"result serialization failed\"}\n".utf8))
    }
}
