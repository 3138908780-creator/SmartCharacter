import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import align_words
from scripts.analyze_faces import faces_for_cues

class EditorPerformanceTests(unittest.TestCase):
    def test_cached_analysis_retimes_changed_text_without_model_audio_or_face_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'cache'; cache.mkdir()
            recognized = [{'character': '新', 'startTime': .2, 'endTime': .4}, {'character': '字', 'startTime': .4, 'endTime': .6}]
            (cache / 'recognized.json').write_text(json.dumps(recognized))
            (cache / 'faces.json').write_text(json.dumps({'samples': []}))
            project = root / 'project.json'; output = root / 'output.json'
            project.write_text(json.dumps({'cues': [{'id': 'a', 'text': '新字', 'start': 0, 'end': 2}]}))
            with patch('sys.argv', ['align_words', '--video', str(root/'missing.mp4'), '--project', str(project), '--output', str(output), '--cache-dir', str(cache)]), patch.object(align_words, 'ensure_model') as model, patch.object(align_words, 'extract_audio') as audio, patch.object(align_words, 'detect_face_samples') as faces:
                align_words.main()
            model.assert_not_called(); audio.assert_not_called(); faces.assert_not_called()
            result = json.loads(output.read_text())
            self.assertEqual(result['cues'][0]['alignmentScore'], 1)
            self.assertEqual(result['cues'][0]['wordTimings'][0]['startTime'], .2)

    def test_face_samples_are_reused_for_new_cue_ids_and_time_ranges(self):
        samples = [{'time': 0, 'faces': [{'x': .2, 'y': .3, 'width': .1, 'height': .2}]}, {'time': 1, 'faces': []}]
        result = faces_for_cues(samples, [{'id': 'new', 'start': 0, 'end': .3}])
        self.assertEqual(result['cues'][0]['id'], 'new')
        self.assertEqual(result['cues'][0]['faceBox']['x'], 20)
