"""CPU YuNet adapter: normalized top-left origin, matching Apple's frame interface."""
from pathlib import Path
import os
import json
import sys

def detect_directory(directory: Path, model: Path):
    import cv2
    if not model.is_absolute() or not model.is_file():
        raise RuntimeError("缺少已校验的 YuNet 模型")
    detector = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.8, 0.3, 5000)
    output = []
    for path in sorted(directory.glob("frame-*.jpg")):
        image = cv2.imread(str(path))
        if image is None:
            raise RuntimeError("人脸检测帧无法读取")
        height, width = image.shape[:2]
        detector.setInputSize((width, height))
        _, faces = detector.detect(image)
        normalized = []
        for face in ([] if faces is None else faces):
            x, y, w, h = map(float, face[:4]); left=max(0,x)/width;top=max(0,y)/height
            right=min(width,x+w)/width;bottom=min(height,y+h)/height
            if right>left and bottom>top:
                normalized.append({"x":left,"y":top,"width":right-left,"height":bottom-top,"confidence":float(face[-1])})
        output.append({"file":path.name,"faces":normalized})
    return output
if __name__ == "__main__":
    try:
        print(json.dumps(detect_directory(Path(sys.argv[1]), Path(os.environ["SC_YUNET_MODEL"])), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr);sys.exit(1)
