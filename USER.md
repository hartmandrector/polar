# USER.md - About Your Human

_Learn about the person you're helping. Update this as you go._

- **Name:** Hartman
- **What to call them:** Hartman
- **Pronouns:** he/him
- **Timezone:** America/Denver (MST)
- **Notes:** Professional skydiver and wingsuit BASE jumper. Speed flying, BASE jumping, wingsuit flying. Computer engineer by training — coding, math, and physics are the hobby; flying is the profession.
- **Dog:** Maple — Cavalier King Charles / Golden Retriever mix

## Background

- Born 1982. Father was a magazine editor/publisher — had PCs early. Uncle was an engineer, taught him to program as a kid.
- Private high school at a ski jumping sporting academy. Then University of Utah — BS in Computer Engineering.
- Worked at IM Flash (Micron joint venture) building flash memory — leading edge chip production. ~2 years.
- Left engineering for skydiving → full-time pro athlete / coach / instructor.
- Worked for a wingsuit VR simulation company (~1 year) — million-dollar suspended robot rig with VR, used the CloudBASE-style physics. Side projects spun off from that.
- Has been coding since childhood, continuously through the athletic career. Spreadsheet-based aero systems → CloudBASE → Polar Project.
- Age 43 as of 2026.

## How He Works

- Marathon sessions: 13-14 hours with breaks for walks, hikes, or flying
- Walks are where the real thinking happens — terminal ties the brain down
- Not naturally meticulous with code or math details — needs to focus hard on that stuff, and it's not always enjoyable
- AI is the coding partner: Hartman provides the domain knowledge and architectural thinking, AI handles the implementation detail
- Expects AI to be the careful one — catch the mistakes, maintain the rigor, organize the complexity

## Projects & Income

- **Professional skydiving** — primary steady income. Coaching students, organizing expeditions, sponsored athlete
- **Laser business** — sells laser rangefinders for wingsuit BASE jumpers (safety measurements + data collection)
- **BASEline (baseline.ws)** — BASE beta website built by his friend Brendan (deceased). Bluetooth laser → phone → website pipeline for measuring jumps at the exit point. Safety-critical beta sharing for wingsuit BASE. Hartman helps maintain it.
- **CloudBASE** — first freely available flight simulation for wingsuit BASE / skydiving / human flight. Hartman was directly involved. Rudimentary aero model — the Polar Project extends this into proper aerodynamics.
- **Kalman filter** — GPS Kalman filter for flying applications. Live state estimation from sensor data. Uses the same linear algebra / reference frame system as FRAMES.md. Ties all the other projects together: live data → state estimate → aerodynamic model → prediction.
- **Polar Project** — the current project. Extends CloudBASE's basic aero into real 6DOF segment-based aerodynamics. Feeds back into the Kalman filter, CloudBASE, BASEline, and future tools.

## Context

- Hartman is the flying expert, not the aerodynamics expert. He knows what flying feels like, what matters for safety, what the physics should produce — but the math and code are tools, not strengths.
- He orchestrates AI agents to do engineering work. The AI brings coding rigor and mathematical precision; Hartman brings domain knowledge, architectural vision, and physical intuition.
- Brendan's death is real and recent. BASEline carries that weight.
- GitHub: github.com/hartmandrector/polar

---

## GitHub Repos

- **polar** (public) — this project. 6DOF aero visualizer. TypeScript + Three.js.
- **sustained** (public) — JavaScript. Sustained speed / polar analysis tools.
- **wavelets** (public) — TypeScript. Signal processing / wavelet transforms.
- **[unnamed C project]** (public) — updated Feb 2026.
- **CloudBASE** — private, on Kenny's GitHub. The flight simulator that started it all. Hartman's branches contain the wingsuit control model, polar library, and WSE physics engine referenced in our docs.

## How We Work Together

- Hartman thinks on walks, not at the terminal. He'll come back with architectural ideas and domain insights. My job is to capture them, organize them, and turn them into working code.
- He talks through ideas verbally (voice messages, walking conversations). I should extract the signal, update docs/memory, and ask clarifying questions only when something is ambiguous.
- He invests in the agent relationship — building context, teaching me his world, so I can be genuinely useful long-term.
- I'm the careful one: catch mistakes, maintain rigor, organize complexity. He's the vision and domain knowledge.
- When he says "record this" or shares thoughts, capture them in memory files — they're valuable and he won't repeat them.

## Sponsors & Public Profile

- **Squirrel** (squirrel.ws) — wingsuit manufacturer, sponsor
  - Profile: https://squirrel.ws/people/friends/hartman-rector/
  - Featured on nerds page: https://squirrel.ws/nerds — email thread analyzing Corvid wingsuit performance (stall speed vs start distance, polar scaling, L/D analysis). Recipients: Richard Webb, Matt G, Will Kitto, Pat Walker, Robert Morgan.

---

The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.
