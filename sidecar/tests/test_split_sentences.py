"""Tests for engine.split_sentences()."""

from capty_sidecar.engine import split_sentences


def test_chinese_sentences():
    text = "你好世界。这是一个测试。谢谢！"
    result = split_sentences(text)
    # "你好世界。" is 5 chars < 10, so merged with next
    assert len(result) == 2
    assert "你好世界。" in result[0]
    assert "谢谢！" in result[1]


def test_chinese_long_sentences():
    text = "这是一个比较长的句子用来测试分句功能。另一个同样很长的句子也在这里。最后一句话。"
    result = split_sentences(text)
    assert len(result) >= 2
    # All original text is preserved
    combined = "".join(result).replace(" ", "")
    assert "测试分句功能" in combined


def test_english_sentences():
    text = "Hello world. This is a test. Thank you!"
    result = split_sentences(text)
    assert len(result) == 3
    assert result[0] == "Hello world."
    assert result[1] == "This is a test."
    assert result[2] == "Thank you!"


def test_mixed_language():
    text = "你好。Hello world. 再见！"
    result = split_sentences(text)
    # "你好。" is 3 chars < 10, so merged with next
    assert len(result) == 2
    assert "你好" in result[0]
    assert "再见" in result[1]


def test_merge_short_segments():
    text = "Hi. OK. This is a longer sentence that should not be merged."
    result = split_sentences(text)
    # "Hi." and "OK." are both < 10 chars, they merge together
    # Then "Hi. OK." is still < 10, so it merges with the next long sentence
    assert len(result) >= 1
    assert "Hi" in result[0]
    assert "OK" in result[0]


def test_cap_long_segment():
    text = "A " * 150  # 300 chars, exceeds 200 cap
    result = split_sentences(text)
    assert all(len(seg) <= 200 for seg in result)
    assert len(result) >= 2


def test_empty_input():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_single_sentence_no_split():
    text = "Just one sentence"
    result = split_sentences(text)
    assert result == ["Just one sentence"]


def test_semicolons():
    text = "Part one; part two; part three."
    result = split_sentences(text)
    assert len(result) >= 2
