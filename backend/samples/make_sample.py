"""Generates samples/sample_interview.json: a synthetic 2-speaker interview transcript.

Entirely fictional. Most answers are spontaneous (uneven pacing, fillers). One answer follows a
long silence and is delivered like read text, and its follow-up adds nothing new, so the offline
demo has something to show. Run: python samples/make_sample.py
"""

import json
import random
from pathlib import Path

random.seed(7)
words: list[dict] = []
t = 2.0


def say(speaker: str, text: str, *, read: bool = False) -> None:
    global t
    for token in text.split():
        if read:
            gap = random.uniform(0.29, 0.33)
        else:
            gap = random.choice([0.18, 0.22, 0.26, 0.3, 0.34, 0.45, 0.6]) + (random.random() < 0.12) * random.uniform(0.4, 1.1)
        words.append({"text": token, "start": round(t, 2), "end": round(t + gap * 0.8, 2), "speaker": speaker})
        t += gap
    t = words[-1]["end"]


def exchange(question: str, answer: str, *, latency: float, read: bool = False) -> None:
    global t
    t += random.uniform(0.8, 1.4)
    say("A", question)
    t += latency
    say("B", answer, read=read)


exchange("Hi Jordan, thanks for joining. How are you today?",
         "Hi, um, I'm good thanks, a bit of a busy morning but, uh, happy to be here. Thanks for making the time, I know you've probably got a lot of these this week.", latency=0.6)
exchange("Any trouble joining the call?",
         "No no, it was fine, um, the link worked first time which, uh, honestly never happens to me, so I'm taking that as a good sign for today.", latency=0.5)
exchange("Good. How was your weekend?",
         "It was nice, um, pretty quiet. We took the dog out to the lake on Saturday and then, uh, I mostly just cooked and watched football on Sunday. Nothing too exciting but, um, it was good to switch off for a bit.", latency=0.7)
exchange("Nice. How's your week going so far at work?",
         "Yeah, um, it's been okay. We're in the middle of a release so it's, uh, a little hectic, lots of small bugs coming in, but the team's good about it and, um, we should be done by Thursday I think.", latency=0.6)
exchange("Great. So tell me about your current role.",
         "Sure. So, um, I'm a backend engineer at a logistics company, I've been there about, uh, three years now. I mostly work on the service that, um, plans delivery routes, so a lot of Python, some Go, and, uh, Postgres underneath. It's a team of five and I kind of, um, own the API side of it, so when other teams need something from routing they usually come to me first.", latency=0.9)
exchange("What is a race condition, and how have you dealt with one?",
         "Right, so, um, a race condition is when, uh, two things touch the same data at the same time and the result depends on who gets there first. We actually had one, um, last year, where two workers would both grab the same delivery job, because, uh, we checked if it was free and then claimed it in two separate queries. So sometimes both saw it as free. We fixed it with, um, a single update that claims the row only if it's still unclaimed, and then, uh, checking how many rows changed. Took a while to find because it only happened under load.", latency=1.3)
exchange("How does a database index work, and when would you not add one?",
         "An index is a separate sorted structure, typically a B-tree, that maps column values to row locations so the database can find matching rows without scanning the whole table. It speeds up reads that filter or sort on the indexed columns. However, every index must be updated on each insert, update, and delete, which slows down writes and consumes additional storage. You would avoid adding an index on columns with low selectivity, on tables that are write-heavy and rarely queried, or on small tables where a sequential scan is already fast. It is also important to consider composite indexes and the order of their columns, since the index can only be used efficiently when the query filters on its leading columns.",
         latency=7.4, read=True)
exchange("Why does the order of columns matter there?",
         "Because the index can only be used efficiently when the query filters on its leading columns, so the order of columns is important to consider.", latency=3.8, read=True)
exchange("Tell me about a time you disagreed with a teammate.",
         "Yeah, um, so there was this one time with, uh, our tech lead actually. He wanted to rewrite the routing service in Go all at once, and I, um, I thought that was too risky right before peak season. So I, uh, put together a small doc showing which endpoints were actually slow, and it was really just two of them. We ended up, um, only moving those two, and honestly he was right that Go helped, it was like, uh, four times faster. But doing it piece by piece meant we didn't break anything in December. So, um, I think we both got something out of it.", latency=1.6)
exchange("How would you design a rate limiter for our public API?",
         "Hmm, okay, let me think about that for a second. So, um, first I'd want to know if it's per user or per key, I'll assume per API key. I'd probably start with, uh, a token bucket, because it allows short bursts which is, um, usually what real clients do. You'd keep a counter and a timestamp per key in, uh, Redis probably, so all the API servers share it. The tricky part is, um, making the check and the decrement atomic, so I'd use a small Lua script for that. And then, uh, return a 429 with a retry-after header so clients can back off properly.", latency=4.2)
exchange("Do you have any questions for me?",
         "Yeah, um, a couple. I was wondering, uh, how the on-call rotation works on your team, and, um, how you decide what gets worked on each quarter.", latency=1.0)

out = Path(__file__).with_name("sample_interview.json")
out.write_text(json.dumps({"words": words, "duration": round(t + 2, 2)}))
print(f"wrote {out} ({len(words)} words, {t/60:.1f} min)")
