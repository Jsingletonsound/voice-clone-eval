
### Title
My voice vs. my AI clone

### Headline
My AI clone passes for me until it meets an ear trained by over ten years in sound and the acoustics to explain what it hears: it breathes where I wouldn't, sits {m} to {m} semitones high, and runs its upper formants {m} to {m} dB hot.

### How I tested
- **The voice:** an ElevenLabs Professional Voice Clone of my own voice, trained on about an hour of audio recorded through ElevenLabs' guided scripts on my studio mic. ElevenLabs recommends 30 minutes minimum and 2–3 hours for best results. Model: Eleven v4.
- **The lines:** three lines written to break a voice in different ways, each tied to a Spotify use case: a DJ intro with hard names, an ad read with numbers, and a question with a pause.
- **The comparison:** my own read of each line, recorded before I heard the clone's version, against the clone's best take.
- **Keepers:** I generated each line several times across ElevenLabs' Stability and Similarity settings and kept the take closest to my own performance.
- **Level:** every clip matched to the same loudness before scoring.
- **Scoring:** my scores are an expert review, not blind.
- **Figures:** spectrograms and measurements made in Python from the same files. ElevenLabs only exported MP3 on my plan, so the figures show 0–12 kHz and my takes go through the same MP3 encoding before comparing. The file format isn't what's being judged.

### How I scored it
Each clip gets 1 to 5 on seven qualities, plus a ship call. A 4 or a 2 falls between the anchors.

| Quality | 5 | 3 | 1 |
| --- | --- | --- | --- |
| Naturalness | Can't tell it's synthetic | Clearly synthetic, easy to listen to | Robotic or distracting |
| Sounds like me | People who know me wouldn't question it | Same type of voice, not me | A different person |
| Tone | Matches the line's intent | Neutral where it should feel something | Wrong emotion |
| Pacing | Pauses and stress where a person puts them | Even and flat | Rushed or broken phrasing |
| Pronunciation | Every word right | One slip | Several slips |
| Accent | Holds across the line | Drifts once | Wanders |
| Audio quality | Clean | Light artifacts | Clicks, warble, noise |

**Fit for use:** ship as is, ship after fixes, or don't ship. One-off faults a post editor can fix ship after fixes; a fault that repeats across lines goes back to the model team.

**Failure tags:** BREATH, PAUSE, STRESS, FLAT, EMO, PRON, CONS (soft consonant), SIB (harsh S), NUM, DRIFT, ART (artifact), CLICK, WORD, ROOM.

### Line 1: DJ intro
> "Up next, something new from Sigur Rós, then a throwback from Beyoncé and Hozier."

Listen: me · clone

| Naturalness | Like me | Tone | Pacing | Pronunciation | Accent | Audio | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 5 | 3 | 3 | 3 | 5 | 3 | Ship after fixes |

**Tags:** BREATH ×2, PAUSE, ART

**What I hear:** It's unmistakably my voice, but pushed up into a bright, high-energy DJ register I don't naturally use, at every setting I tried.

The bigger problem is breath. There's an audible exhale right after "Up next," exactly where a performer would hold air to carry that line, and a second one after "Sigur Rós." If a voice actor did this in my session, I'd stop them: two exhales in one energetic line leave no breath support for the finish. If a breath belongs anywhere, it's a quick inhale after the band name.

"Sigur Rós" also comes out as two separate words with a gap, so it doesn't land as a band name.

The subtler tell is "Hozier," and it took a trained ear to catch. The clone loses its low end there, as if someone EQ'd it thin, and the "-er" carries a fry-like crackle with none of the low-frequency energy real vocal fry has. My read has fry there too, but it has low-end support under it, so it reads as vocal folds, not crackle. Real fry is the folds going slack and closing in slow, uneven pulses, and every pulse still carries the body of the voice. The clone has the clicks without the body. That mismatch is what tells my ear it isn't a person.

Ship after fixes. The crackle and the stray breaths are one-off edits I could clean up in post, and I could edit around the split band name. If these faults repeated across lines, I'd send it back to the model team instead.

**Figure A caption:** "Hozier," me vs. clone. The fundamental sits in about the same place, but below it my take still has texture and the clone's is a smooth smear. The clone's pitch also bends down and back up twice across the word, where mine falls in one steady line and dips once into the "-er": that's the DJ energy, visible.

### Line 2: ad read
> "Get 3 months free, then $11.99 a month. Terms at spotify.com/premium."

Listen: me · clone

| Naturalness | Like me | Tone | Pacing | Pronunciation | Accent | Audio | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 4 | 4 | 5 | 5 | 5 | 4 | Ship after a light fix |

**Tags:** ART ×2

**What I hear:** This is the most shippable line in the test, and the closest to my own read. It's still pitched a little high and a little energetic, but an ad read can carry that energy, so it lands near how I'd do it.

The one issue is light, and it isn't spit. On "Get" and again on "then," right where the read pushes energy, the clone puts about {m} to {m} dB more energy into the upper formants, around 3–4 kHz, than my voice does. The first two formants mostly set the vowel; the higher ones carry more of a speaker's individual character, and that's where it stops sounding like me. It runs hot on all three lines, and "Get" is the hottest word I measured. Same frequencies; they're just too loud. It's still a light fix: a non-destructive spectral repair on just those formants, and since it comes across a little like crackle, a light batch de-crackle after generation.

One line I'd hold firm on: batch processing is fine for finished output, never for the recordings a voice is trained on. Whatever goes into the training audio, artifacts included, becomes part of what the model learns.

### Line 3: question and pacing
> "So... what are you in the mood for tonight? Something slow?"

Listen: me · clone 1 (rejected) · clone 2 (keeper)

| Take | Naturalness | Like me | Tone | Pacing | Pronunciation | Accent | Audio | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Clone 1 (rejected) | 3 | 4 | 4 | 3 | 4 | 5 | 4 | Don't ship |
| Clone 2 (keeper) | 4 | 4 | 4 | 4 | 4 | 5 | 4 | Ship after fixes (de-ess) |

**Tags:** SIB. Rejected takes: BREATH ×2, CLICK

**What I hear:** This line shows how small the gap is between a giveaway and a keeper. Two generations at the same settings, both with great pitch and performance. The first one breathes twice: a mouth exhale after "So," then a nasal exhale after "tonight." That second breath is a dead giveaway. Nobody spends air twice in a line this short. It isn't just the count, though. The exhale after "So" starts while the vowel is still sounding, sitting right on the fundamental, so cutting it means cutting into the voice. Newer repair tools could probably save it, but a potentially destructive edit is reason enough to send it back and get the model to stop doing it.

The second generation goes straight from "So" into "What are you in the mood for tonight?" with one slight nasal exhale before "Something slow?" One breath, in the right place, and it's believable: it sounds like a real person talking. That's the keeper.

It's pitched up, and five takes couldn't bring it down. It doesn't start high, though: on "So" it sits below me, then jumps almost an octave on "What are you in the mood for" while I settle. "What are you in the mood for" sounds excited, which this line can carry. Both of us soften the T in "tonight," so I don't count that against it.

What I didn't catch until I compared the two: the S in "So." A real S is turbulent air, a texture with no pitch in it. The clone's S has a narrow, tonal streak running through it, almost like a fundamental, and mine has nothing like it. That's what makes it harsh in a way that isn't realistic, not just bright. I could attenuate it and ship this line. If every line did it, I'd send it back to the model team.

**Figure B caption:** The S in "So," me vs. clone, 0–12 kHz, both through the same MP3 encoding.

### What the model team should fix
Ranked by how often each problem came up. My rule: a one-off fault a post editor can fix ships after fixes; a fault that repeats goes back to the model team. Each line's verdict above is about that line alone; this list is about the model across all three.

### Next step
Next, I'd run the same rubric and these three lines through other voice models, and add blind listeners so the scores aren't mine alone.

