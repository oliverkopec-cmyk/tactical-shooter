// Round and match flow for one room:
//   intro -> prep -> action -> round end -> (next round | match end)
// Scores are kept per squad (A starts attacking, B starts defending) so they
// follow the players when sides swap at halftime.

import { MAP } from '../shared/map.js';
import { inObjectiveZone } from '../shared/rules.js';
import {
  PHASE, INTRO_MS, PREP_MS, ACTION_MS, ROUND_END_MS, MATCH_END_MS, ROUNDS_TO_WIN,
  HALFTIME_AFTER_ROUND, CAPTURE_TIME,
} from '../shared/constants.js';

// Test hook: TIME_SCALE=0.1 makes every phase ten times shorter.
const SCALE = Number(process.env.TIME_SCALE) > 0 ? Number(process.env.TIME_SCALE) : 1;
const ms = (v) => Math.round(v * SCALE);

export class RoundManager {
  constructor(game) {
    this.game = game;
    this.phase = PHASE.INTRO;
    this.endsAt = 0;
    this.round = 0;
    this.swapped = false;                 // squad A defends once true
    this.squadScores = { A: 0, B: 0 };
    this.capture = 0;                     // seconds held
    this.contested = false;
    this.matchOver = false;
    this.lastResult = null;
  }

  // ---------------------------------------------------------------- sides and scores

  /** Which squad plays a side right now. */
  squadOf(side) {
    const attackSquad = this.swapped ? 'B' : 'A';
    return side === 'attack' ? attackSquad : (attackSquad === 'A' ? 'B' : 'A');
  }

  sideOf(squad) {
    return this.squadOf('attack') === squad ? 'attack' : 'defense';
  }

  /** Scores keyed by the side each squad currently plays. */
  scoresBySide() {
    return { attack: this.squadScores[this.squadOf('attack')], defense: this.squadScores[this.squadOf('defense')] };
  }

  info() {
    return {
      phase: this.phase, endsAt: this.endsAt, round: this.round,
      scores: this.scoresBySide(), matchOver: this.matchOver,
    };
  }

  // ---------------------------------------------------------------- flow

  start(now = Date.now()) {
    this.round = 0;
    this.swapped = false;
    this.squadScores = { A: 0, B: 0 };
    this.matchOver = false;
    this.beginRound(now);
  }

  beginRound(now) {
    this.round++;
    this.capture = 0;
    this.contested = false;
    this.lastResult = null;
    this.game.resetRound();
    this.phase = PHASE.INTRO;
    this.endsAt = now + ms(INTRO_MS);
    this.shortened = false;
    for (const id of this.game.players.keys()) {
      const team = this.game.players.get(id).member.team;
      this.game.io.to(id).emit('roundStart', { ...this.game.startPayload(team), round: this.info() });
    }
  }

  setPhase(phase, duration, now) {
    this.phase = phase;
    this.endsAt = now + ms(duration);
    if (phase === PHASE.PREP) this.game.beginPrep();
    else if (phase === PHASE.ACTION) this.game.beginAction();
    this.game.emitAll('phase', this.info());
  }

  update(now, dt) {
    switch (this.phase) {
      case PHASE.INTRO:
        // Operator select ends when time is up, or shortly after everyone has chosen
        if (!this.shortened && this.game.allPicked()) {
          this.shortened = true;
          this.endsAt = Math.min(this.endsAt, now + ms(2500));
          this.game.emitAll('phase', this.info());
        }
        if (now >= this.endsAt) {
          this.game.finalizeOperators();
          this.game.finalizeSite();
          this.setPhase(PHASE.PREP, PREP_MS, now);
        }
        break;
      case PHASE.PREP:
        if (now >= this.endsAt) this.setPhase(PHASE.ACTION, ACTION_MS, now);
        break;
      case PHASE.ACTION:
        this.updateAction(now, dt);
        break;
      case PHASE.ROUND_END:
        if (now >= this.endsAt) {
          if (this.matchOver) this.game.finishMatch();
          else this.nextRound(now);
        }
        break;
      default:
    }
  }

  updateAction(now, dt) {
    const { attackersAlive, defendersAlive, attackersIn, defendersIn } = this.census(dt);

    if (attackersAlive === 0) return this.endRound('defense', 'All attackers eliminated', now);
    if (defendersAlive === 0) return this.endRound('attack', 'All defenders eliminated', now);

    // Hold the zone: attackers inside and no living defender inside.
    const prev = this.capture;
    if (attackersIn > 0 && defendersIn === 0) {
      this.contested = false;
      this.capture += dt;
    } else if (attackersIn > 0) {
      this.contested = true;            // progress is frozen while defenders contest
    } else {
      this.contested = false;
      this.capture = 0;                 // nobody holding: starts over
    }
    if (prev !== this.capture && this.capture >= CAPTURE_TIME) return this.endRound('attack', 'Objective secured', now);

    if (now >= this.endsAt) this.endRound('defense', 'Time ran out', now);
  }

  census(dt = 0) {
    const out = { attackersAlive: 0, defendersAlive: 0, attackersIn: 0, defendersIn: 0 };
    for (const p of this.game.players.values()) {
      if (!p.alive) continue;
      const inZone = inObjectiveZone(this.game.activeSite(), p.state);
      if (inZone) p.stats.objSecs += dt;     // time on the objective earns Money and counts for quests
      if (p.member.team === 'attack') { out.attackersAlive++; if (inZone) out.attackersIn++; }
      else { out.defendersAlive++; if (inZone) out.defendersIn++; }
    }
    return out;
  }

  endRound(winnerSide, reason, now) {
    if (this.phase === PHASE.ROUND_END) return;
    const winnerSquad = this.squadOf(winnerSide);
    this.squadScores[winnerSquad]++;
    this.matchOver = this.squadScores[winnerSquad] >= ROUNDS_TO_WIN;
    const halftime = !this.matchOver && this.round === HALFTIME_AFTER_ROUND;
    this.phase = PHASE.ROUND_END;
    this.endsAt = now + ms(this.matchOver ? MATCH_END_MS : ROUND_END_MS);
    this.lastResult = { winner: winnerSide, reason, halftime };
    if (this.matchOver) this.game.settleMatch(winnerSquad);
    this.game.emitAll('roundEnd', {
      ...this.info(), winner: winnerSide, reason, halftime,
      matchOver: this.matchOver,
    });
  }

  nextRound(now) {
    if (this.round === HALFTIME_AFTER_ROUND) this.game.swapSides(this.swapped = !this.swapped);
    this.beginRound(now);
  }
}
