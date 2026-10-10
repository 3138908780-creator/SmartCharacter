import AppKit
import Foundation
import Vision

struct Face: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Double
}

struct FrameDetection: Codable {
    let file: String
    let faces: [Face]
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: detect_faces <frame-directory>\n".utf8))
    exit(2)
}

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let files = (try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))
    .filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

let results: [FrameDetection] = files.map { url in
    guard let image = NSImage(contentsOf: url),
          let data = image.tiffRepresentation,
          let representation = NSBitmapImageRep(data: data),
          let cgImage = representation.cgImage else {
        return FrameDetection(file: url.lastPathComponent, faces: [])
    }
    let request = VNDetectFaceRectanglesRequest()
    do {
        try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])
    } catch {
        return FrameDetection(file: url.lastPathComponent, faces: [])
    }
    let faces = (request.results ?? []).map { observation in
        let box = observation.boundingBox
        return Face(
            x: box.minX,
            y: 1 - box.maxY,
            width: box.width,
            height: box.height,
            confidence: Double(observation.confidence)
        )
    }
    return FrameDetection(file: url.lastPathComponent, faces: faces)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(results))
