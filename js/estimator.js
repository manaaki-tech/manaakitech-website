/* ====================================================================
 *  Manaaki Tech, Estimator
 *
 *  ARCHITECTURE
 *  Each service is a self-contained object: its own questions, its own
 *  pricing function, and a list of shared questions it needs. The engine
 *  collects questions from the selected services (deduplicating shared
 *  ones), runs each service's price(), sums the lines, then applies the
 *  global modifiers.
 *
 *  To add a service: append one object to SERVICES. Nothing else changes.
 *
 *  Every rate mirrors a published pricing page: pricing.html for the core
 *  consultancy services, india.html ("What It Costs") for the NZ-India FTA
 *  service. If a price changes there, change it here.
 * ==================================================================== */

(function () {
  'use strict';

  /* ------------------------------ rates ---------------------------- */

  var RATES = {
    rmFramework: 2500,
    registerCreate: 1450,
    registerReviewRefresh: 950,
    riskWorkshop: 1600,
    /* 20 hours at $140/hr, the rate the audit work is built on. */
    bcpPlan: 2800,
    policyPerPolicy: 120,
    policyReport: 600,
    policySession: 120,
    policyUpdate: 275,
    policyDraft: 550,
    financeHealthCheck: 3720,
    financeDeepDive: 5500,
    accredGapAnalysis: 3500,
    /* First-time preparation is the whole standards framework, comparable to
       CHP registration at $9,500 rather than to a gap analysis. Renewal is a
       gap analysis plus preparing and lodging the renewal itself, which is
       why it is not the same price as simply staying on top of it. */
    accredFullPrep: 10000,
    accredRenewalSupport: 2000,
    budgetBase: 3200,
    allocationMethodology: 1200,
    profitabilityBase: 2800,
    profitabilityExtraProgramme: 2200,
    /* One area is about 40 hours end to end at $140/hr. The organisation
       level work, structure, funding model, systems, engagement setup and
       report format, is roughly five hours and you only do it once, so a
       second area is 35 hours. Reviews inside an annual programme are
       narrower again, about 30 hours, because by then we know the place. */
    internalAuditFirstArea: 5600,
    internalAuditExtraArea: 4900,

    /* Four areas or more is a year's work however it is described, so that
       is where it becomes a programme. No separate programme rate: at four
       areas the formula already gives 5600 + 3 x 4900 = 20300, so the two
       cannot drift apart. */
    auditProgrammeFrom: 4,
    presentationFirst: 900,
    presentationExtra: 700,
    chpReadiness: 2800,
    chpRegistration: 9500,
    chpViabilityModel: 3200,
    chpStandardGap: 2500,
    chpAnnualCompliance: 3400,

    /* Ongoing support. One hour a week costs $105 x 52 / 12 = $455 a month,
       so a month is 4.333 weeks, never 4 and never 5. That way months with
       five weeks and months with four cost the client the same and it comes
       out exactly right across a year. Minimum engagement is 10 hours a
       week, roughly two hours a day. */
    supportHourlyRate: 105,
    supportMonthlyPerWeeklyHour: 455,
    supportMinimumWeeklyHours: 10,

    /* NZ-India FTA, mirrors the "What It Costs" table on india.html. */
    indiaFeasibility: 7500,
    indiaEntityStructuring: 4500,
    indiaCaptiveFeasibility: 8500,
    indiaTpCharacterisation: 1400,
    indiaSafeHarbour: 2400,
    indiaTpDocumentation: 9500,
    indiaOngoingCompliance: 3600
  };

  /* --------------------------- loading factors ---------------------
   * Derived from hours, not picked. Re-test against real jobs.
   *
   * Accreditation mapping, locating the relevant clauses, checking the
   * policy addresses each, noting the reference an assessor can follow:
   *   1st standard  ~20 min/policy -> ~15%
   *   2nd standard  ~12 min/policy -> cumulative ~25% (policy already read)
   *   3rd standard  ~8  min/policy -> cumulative ~32%
   *
   * Priority scheduling, displacement, not extra hours. Compressing eight
   * weeks into four means rescheduling work already booked.
   *
   * No discount for an open deadline. The work takes the same hours
   * whenever it is scheduled, so it costs the same. Urgent still loads,
   * because displacing booked work is a real cost.
   *
   * Combined engagement, one set of meetings, one report structure, one
   * onboarding. Genuine overlap, so it is passed on.
   * ---------------------------------------------------------------- */

  /* Two genuinely separate regimes. The Social Sector Accreditation
     Standards are administered by Te Kahui Kahu on behalf of MSD, Oranga
     Tamariki, the Ministry of Justice and the Social Investment Agency -
     one framework, several funders. Nga Paerewa is health and disability
     certification under a different regime with different auditors, so
     holding both is a real second mapping exercise. */
  var FRAMEWORK_FACTOR = { 0: 1, 1: 1.15, 2: 1.35 };

  /* Assessment level is the larger cost driver. Level 4 is a different
     scale of work from Level 1. Where an organisation holds several
     contracts it is assessed at the highest level any of them require. */
  var LEVEL_FACTOR = { l1: 0.85, l2: 1, l3: 1.15, l4: 1.3, unsure: 1 };
  var LEVEL_LABEL = { l1: 'Level 1', l2: 'Level 2', l3: 'Level 3', l4: 'Level 4' };

  /* Care partner approval covers ground the accreditation work does not:
     caregiver recruitment, assessment and approval, caregiver support and
     training, care planning, and monitoring and visiting. Roughly four
     domains of policy, procedure and evidence. The governance, complaints
     and safety-checking base comes out of the accreditation preparation
     running alongside, which is why this is the addition rather than a
     second engagement. */
  var OT_APPROVAL_FEE = 6000;
  /* Urgent sits a further 10% above the three-month loading: 1.15 x 1.10,
     rounded. Compressing into a month means displacing work already booked
     and usually working around someone else's committed dates. */
  var DEADLINE_FACTOR = { urgent: 1.25, soon: 1.15, mid: 1, later: 1, none: 1 };
  var SIZE_FACTOR = { xs: 0.95, s: 1, m: 1.1, l: 1.2 };
  var COMBINED_FACTOR = { 1: 1, 2: 0.95, 3: 0.92, 4: 0.92 };

  /* Above this we still show the figure, we just say plainly that it is more
     than most organisations take on at once and offer to sequence it. We used
     to hide the number entirely past a threshold, which was wrong: every line
     now has a defined scope and a fixed price, so a large total is as
     reliable as a small one. Someone who picks four services and answers
     fifteen questions has earned an answer. */
  var SEQUENCING_NOTE_ABOVE = 35000;

  /* The least we will take a piece of work on for. The estimator must never
     quote under these: showing a low number and then quoting higher is the
     bait the Fair Trading Act is concerned with, and below these figures the
     job stops being worth setting up at all. The pricing page no longer
     lists prices, so these are the only place the minimums are written
     down. */
  var SERVICE_FLOOR = {
    risk: 950,           /* Risk Register Review */
    policy: 840,         /* Policy Health Check, 1 policy + report + session */
    finance: 0,          /* computed in serviceFloor(), it has two products */
    budget: 3200,        /* Annual Budget Build */
    audit: 5600,         /* Internal audit, one area */
    accreditation: 3000, /* Project work */
    chp: 2800,           /* CHP Registration Readiness */
    india: 1400          /* Transfer Pricing Characterisation Review, the cheapest standalone line */
  };

  function serviceFloor(id, a) {
    /* Financial review covers two separately published products, the
       Financial Health Check at $3,720 and Programme profitability at
       $2,800. A single floor would let a profitability-only job be quoted
       under its own published price, so the floor follows what was asked
       for. */
    if (id === 'finance') {
      var want = Array.isArray(a.fin_depth) ? a.fin_depth : [];
      var f = 0;
      if (want.indexOf('read') !== -1 || want.indexOf('dig') !== -1) {
        f += RATES.financeHealthCheck;
      }
      if (want.indexOf('profit') !== -1) {
        f += RATES.profitabilityBase;
      }
      return f;
    }

    return SERVICE_FLOOR[id] || 0;
  }

  /* --------------------------- shared questions -------------------- */

  var SHARED = {
    frameworks: {
      id: 'frameworks',
      multi: true,
      q: 'Which accreditation or certification applies to you?',
      hint: 'Select all that apply. Plenty of organisations only need the first one.',
      options: [
        {
          v: 'ssas',
          label: 'Social Sector Accreditation (Te Kāhui Kāhu)',
          sub: 'Covers MSD, Oranga Tamariki, Justice and SIA contracts'
        },
        {
          v: 'paerewa',
          label: 'Ngā Paerewa health and disability certification',
          sub: 'Residential mental health or addiction, disability services, or home and community support'
        },
        { v: 'none', label: 'Neither, or not sure', exclusive: true }
      ]
    },
    ssasLevel: {
      id: 'ssasLevel',
      showIf: function (a) { return (a.frameworks || []).indexOf('ssas') !== -1; },
      q: 'What level are you assessed at?',
      hint: 'If you hold several contracts, it is the highest level any of them require.',
      options: [
        { v: 'l1', label: 'Level 1' },
        { v: 'l2', label: 'Level 2' },
        { v: 'l3', label: 'Level 3' },
        { v: 'l4', label: 'Level 4' },
        { v: 'unsure', label: 'Not sure' }
      ]
    },
    otApproval: {
      id: 'otApproval',
      showIf: function (a) { return (a.frameworks || []).indexOf('ssas') !== -1; },
      q: 'Do you also need Oranga Tamariki care partner approval?',
      options: [
        { v: 'yes', label: 'Yes' },
        { v: 'no', label: 'No' },
        { v: 'unsure', label: 'Not sure' }
      ]
    },
    entities: {
      id: 'entities',
      number: true,
      min: 1,
      max: 20,
      suffix: 'entities',
      placeholder: 'e.g. 1',
      q: 'How many entities do you have?',
      hint: 'Separate legal entities, each with its own set of accounts. Not departments or programmes, which sit underneath one entity.'
    },
    costCentres: {
      id: 'costCentres',
      number: true,
      min: 1,
      max: 50,
      suffix: 'departments or programmes',
      placeholder: 'e.g. 4',
      q: 'How many departments or programmes do you report on separately?',
      hint: 'Each one with its own tracking code, cost centre or funder report.'
    },
    allocation: {
      id: 'allocation',
      showIf: function (a) { return (parseInt(a.costCentres, 10) || 1) > 1; },
      q: "Do you have an agreed way of splitting shared costs like rent, admin and the CEO's time across your departments or programmes?",
      hint: 'Written down somewhere, so a funder or an auditor can follow how you got there.',
      options: [
        { v: 'yes', label: 'Yes, and it is documented' },
        { v: 'informal', label: 'We split it somehow, but it is not written down' },
        { v: 'no', label: 'No' }
      ]
    },
    tracking: {
      id: 'tracking',
      showIf: function (a) { return (parseInt(a.costCentres, 10) || 1) > 1; },
      q: 'Is that tracked properly in your accounting system?',
      options: [
        { v: 'yes', label: 'Yes, in Xero or similar' },
        { v: 'partly', label: 'Partly: spreadsheets alongside' },
        { v: 'no', label: 'No, it is all spreadsheets' }
      ]
    },
    size: {
      id: 'size',
      q: 'How many people work for your organisation?',
      options: [
        { v: 'xs', label: 'Fewer than 5' },
        { v: 's', label: '5 to 20' },
        { v: 'm', label: '21 to 50' },
        { v: 'l', label: 'More than 50' }
      ]
    },
    deadline: {
      id: 'deadline',
      q: 'Is there a deadline you are working to?',
      options: [
        {
          v: 'urgent',
          label: 'Urgent: within a month',
          sub: 'Tell us the actual date when you get in touch'
        },
        { v: 'soon', label: '1 to 3 months' },
        { v: 'mid', label: '3 to 6 months' },
        { v: 'later', label: '6 to 12 months' },
        { v: 'none', label: 'No fixed deadline' }
      ]
    }
  };

  /* ------------------------------ services ------------------------- */

  var SERVICES = [
    {
      id: 'risk',
      name: 'Risk Management',
      blurb: 'A register your board can actually use, and a plan for when things go wrong.',
      uses: ['deadline'],
      questions: [
        {
          id: 'risk_framework',
          q: 'Do you need a Risk Management Framework?',
          options: [
            {
              v: 'yes',
              label: 'Yes, we need the framework',
              sub: 'The policy, the procedure written to ISO 31000:2018, and a risk register template'
            },
            { v: 'no', label: 'No, we already have one that works' }
          ]
        },
        {
          id: 'risk_register',
          q: 'What do you need on your risk register?',
          hint: 'The framework and the register are priced separately, so you can take one without the other.',
          options: [
            {
              v: 'create',
              label: 'Create ours from scratch',
              sub: 'Populated with the risks you actually carry'
            },
            {
              v: 'refresh',
              label: 'Review and refresh the one we have',
              sub: 'You have a register, it needs checking and bringing up to date'
            },
            { v: 'none', label: 'Nothing needed on the register' }
          ]
        },
        {
          id: 'risk_bcp',
          q: 'Do you want a business continuity plan?',
          hint: 'What has to keep running when something goes wrong, who does what, and how you stand the service back up.',
          options: [
            { v: 'yes', label: 'Yes, for our critical services' },
            { v: 'no', label: 'No' }
          ]
        },
        {
          id: 'risk_sessions',
          q: 'Do you want a facilitated session?',
          hint: 'A register written at a desk is a list. One written in a room with the people who carry the risks is a register. Three hours, with your leadership team or your board, whichever suits.',
          options: [
            { v: 'yes', label: 'Yes, one three hour session' },
            { v: 'no', label: 'No, work from what we have' }
          ]
        }
      ],
      price: function (a) {
        var lines = [];
        var notes = [];

        /* Each line is a published fixed price, charged separately exactly as
           the pricing page lists them. Nothing is bundled invisibly. */
        if (a.risk_framework === 'yes') {
          lines.push({
            label: 'Risk Management Framework',
            amount: RATES.rmFramework,
            fixed: true
          });
          notes.push(
            'The framework is the risk management policy, the procedure written to ISO 31000:2018, and a risk register template your team can use. It does not include filling that register in with your own risks, which is the separate line above or below it. You can take either one without the other.'
          );
        }

        if (a.risk_register === 'create') {
          lines.push({
            label: 'Creating your risk register',
            amount: RATES.registerCreate,
            fixed: true
          });
        } else if (a.risk_register === 'refresh') {
          lines.push({
            label: 'Reviewing and refreshing your existing register',
            amount: RATES.registerReviewRefresh,
            fixed: true
          });
          notes.push(
            'A register is worth a second read even when it looks current. We check coverage against what actually goes wrong in your sector, test whether the ratings still reflect the controls you have, and bring it up to date. If it is in good shape we will say so, and that is a useful thing for a board to hear from someone outside.'
          );
        }

        if (a.risk_bcp === 'yes') {
          lines.push({
            label: 'Business continuity plan, critical services',
            amount: RATES.bcpPlan,
            fixed: true
          });
          notes.push(
            'The continuity plan covers your critical services: what has to keep running, who does what, what you depend on outside the organisation, and how you stand things back up. The fee assumes you can tell us which services are critical and what you already have in place. Where that groundwork does not exist we will say so before starting rather than absorbing it.'
          );
        }

        /* One session, one rate, whoever is in the room. Presenting to the
           board is that session, not a separate product on top of it. */
        if (a.risk_sessions === 'yes') {
          lines.push({
            label: 'Facilitated risk session, 3 hours',
            amount: RATES.riskWorkshop,
            fixed: true
          });
        }

        if (a.risk_sessions === 'no' && a.risk_register === 'create') {
          notes.push(
            "Worth saying plainly: a register built without a workshop is our view of your risks, not your team's. It will be tidier and less useful. We will still do it if that is what suits you."
          );
        }

        return { lines: lines, notes: notes };
      }
    },

    {
      id: 'policy',
      name: 'Policies',
      blurb: 'Current, practical, and matching what your team actually does.',
      uses: ['frameworks', 'ssasLevel', 'size', 'deadline'],
      questions: [
        {
          id: 'policy_count',
          number: true,
          min: 1,
          max: 200,
          suffix: 'policies',
          placeholder: 'e.g. 24',
          q: 'How many policies do you have?',
          hint: 'A rough count is fine. The Health Check is priced per policy, so this is the number that sets the figure.'
        },
        {
          id: 'policy_age',
          q: 'When were they last reviewed?',
          options: [
            { v: 'recent', label: 'Within the last year' },
            { v: 'mid', label: 'One to three years ago' },
            { v: 'old', label: 'More than three years ago' },
            { v: 'unknown', label: 'Not sure' }
          ]
        }
      ],
      price: function (a) {
        var MIX = {
          recent: { update: 0.2, draft: 0.05 },
          mid: { update: 0.5, draft: 0.1 },
          old: { update: 0.6, draft: 0.2 },
          unknown: { update: 0.55, draft: 0.15 }
        };
        var count = Math.max(1, parseInt(a.policy_count, 10) || 1);
        var mix = MIX[a.policy_age];
        var sizeF = SIZE_FACTOR[a.size] != null ? SIZE_FACTOR[a.size] : 1;
        var fw = (a.frameworks || []).filter(function (x) { return x !== 'none'; });
        var n = Math.min(fw.length, 2);
        var levelF = fw.indexOf('ssas') !== -1
          ? (LEVEL_FACTOR[a.ssasLevel] != null ? LEVEL_FACTOR[a.ssasLevel] : 1)
          : 1;

        var updates = Math.round(count * mix.update);
        var drafts = Math.round(count * mix.draft);
        var work =
          (updates * RATES.policyUpdate + drafts * RATES.policyDraft) *
          sizeF *
          FRAMEWORK_FACTOR[n] *
          levelF;

        var factors = [];
        if (n === 1) {
          factors.push('Mapping each policy to the standards you are assessed against');
        } else if (n === 2) {
          factors.push('Mapping each policy against both the Social Sector Accreditation Standards and Ngā Paerewa');
        }
        if (fw.indexOf('ssas') !== -1 && LEVEL_LABEL[a.ssasLevel]) {
          factors.push('Assessment at ' + LEVEL_LABEL[a.ssasLevel]);
        }

        var notes = [
          'The split between updating and writing fresh is an estimate. The Health Check is what tells us the real number, and we confirm the policy fee after it, not before.'
        ];

        /* Past about 40 the suite is big enough that a count alone is a poor
           guide to the work, so say so rather than quietly pricing it. */
        if (count > 40) {
          notes.push(
            'A suite this size is usually worth scoping with us rather than pricing off a count. The rate above is our published one, but past about 40 policies there is normally overlap and duplication worth finding before you commit.'
          );
        }

        return {
          lines: [
            {
              label:
                'Policy Health Check, ' + count + ' ' +
                (count === 1 ? 'policy' : 'policies') + ' at $' +
                money(RATES.policyPerPolicy) + ' each',
              amount: count * RATES.policyPerPolicy,
              fixed: true
            },
            {
              label:
                'Written report ($' + money(RATES.policyReport) +
                ') and a one hour session ($' + money(RATES.policySession) + ')',
              amount: RATES.policyReport + RATES.policySession,
              fixed: true
            },
            {
              label:
                'Policy work, roughly ' + updates + ' updated' +
                (drafts > 0 ? ', ' + drafts + ' written fresh' : ''),
              amount: Math.round(work)
            }
          ],
          factors: factors,
          notes: notes
        };
      }
    },

    {
      id: 'finance',
      name: 'Financial Review',
      blurb: 'A clear read on where your finances actually stand.',
      uses: ['entities', 'costCentres', 'allocation', 'tracking', 'deadline'],
      questions: [
        {
          id: 'fin_records',
          q: 'How are your accounts kept?',
          options: [
            { v: 'clean', label: 'Reconciled to last month, in Xero or similar' },
            { v: 'behind', label: 'A few months behind' },
            { v: 'messy', label: 'Spreadsheets, or honestly a bit of a mess' }
          ]
        },
        {
          id: 'fin_depth',
          multi: true,
          q: 'What do you need from it?',
          hint: 'Select all that apply.',
          options: [
            { v: 'read', label: 'A read on where we stand' },
            { v: 'dig', label: "Something's wrong and we want it found" },
            {
              v: 'profit',
              label: "Which programmes are making money and which aren't",
              sub: 'Contribution by programme, and what is subsidising what'
            }
          ]
        },
      ],
      price: function (a, selected) {
        selected = selected || [];
        var want = Array.isArray(a.fin_depth) ? a.fin_depth : [];
        var wantsProfit = want.indexOf('profit') !== -1;
        var wantsReview = want.indexOf('read') !== -1 || want.indexOf('dig') !== -1;

        var lines = [];
        var notes = [];
        var factors = [];

        /* ---- review ---- */
        if (wantsReview) {
          var forceDeep = a.fin_records !== 'clean' || want.indexOf('dig') !== -1;
          lines.push({
            label: forceDeep
              ? 'Finance Deep Dive, one entity'
              : 'Financial Health Check, one entity',
            amount: forceDeep ? RATES.financeDeepDive : RATES.financeHealthCheck,
            fixed: true
          });

          /* A second entity is a second company: its own accounts, its own
             reserves and going concern picture, plus consolidation on top.
             It is not an add-on, so we scope a group rather than discount it. */
          if ((parseInt(a.entities, 10) || 1) > 1) {
            notes.push(
              'The figure above covers one entity. Each additional entity is a company in its own right, with its own accounts to read and its own reserves and going concern picture, and then the consolidation on top. That is a group review rather than a Health Check with extras, so we would scope it with you and quote it properly rather than put a number on it here.'
            );
          }
          if (a.fin_records === 'behind') {
            notes.push(
              "We have assumed a Deep Dive, since accounts a few months behind need reconciliation work a desktop read can't do."
            );
          }
        }

        /* ---- programme profitability ---- */
        if (wantsProfit) {
          /* Five years of data per programme. The organisation-level setup,
             agreeing the allocation basis and pulling the data, happens once;
             every programme after that is still its own five-year analysis,
             so it is priced near full rather than as an add-on. */
          var progs = Math.max(1, parseInt(a.costCentres, 10) || 1);
          var progAmount =
            RATES.profitabilityBase + (progs - 1) * RATES.profitabilityExtraProgramme;
          lines.push({
            label:
              progs === 1
                ? 'Programme profitability, five years for one programme'
                : 'Programme profitability, five years each for ' + progs + ' programmes',
            amount: Math.round(progAmount)
          });

          notes.push(
            'We look at five years for each programme, so you see the trend rather than one year that might be unusual. The first is $' +
              money(RATES.profitabilityBase) + ' and each one after that is $' +
              money(RATES.profitabilityExtraProgramme) + ', because the organisation-level work and the allocation basis are only done once.'
          );
          if (progs > 1) {
            notes.push(
              "Most boards can't say which of their contracts is subsidising the others. This answers that, and it usually changes how the next funding round gets negotiated."
            );
          }
          notes.push(
            'If you only want the programmes that worry you rather than all of them, say so and we will scope it to those.'
          );
        }

        /* ---- overhead allocation, charged once across the engagement ---- */
        var needsAllocation =
          (parseInt(a.costCentres, 10) || 1) > 1 &&
          a.allocation !== 'yes' &&
          (wantsProfit || wantsReview);
        /* If the budget service is also selected it carries this line instead. */
        if (needsAllocation && selected.indexOf('budget') === -1) {
          lines.push({
            label: 'Working out how shared costs are split across your departments and programmes',
            amount: RATES.allocationMethodology,
            fixed: true
          });
          notes.push(
            "You can't say what a programme costs until you have agreed how shared overhead is split. We build that methodology once, after the first year it is just updated."
          );
        }

        /* ---- system caveat ---- */
        if (a.tracking === 'no' || a.tracking === 'partly') {
          notes.push(
            a.tracking === 'no'
              ? "Programme reporting run entirely in spreadsheets usually needs the accounting system set up properly first. That is a separate piece of work and we would quote it separately; we won't absorb it quietly into this."
              : 'Where tracking is split between your accounting system and spreadsheets, expect some reconciliation work. We will flag it before it eats into the budget.'
          );
          factors.push('Programme data spread across systems');
        }

        if (a.fin_records === 'messy') {
          notes.push(
            "Records that aren't in an accounting system usually need tidying before a review is worth doing. We would quote that separately, and we would tell you before starting rather than after."
          );
        }

        return { lines: lines, notes: notes, factors: factors };
      }
    },

    {
      id: 'budget',
      name: 'Budgeting & Planning',
      blurb: 'The year ahead, built with you rather than handed to you.',
      uses: ['entities', 'costCentres', 'allocation', 'tracking', 'deadline'],
      questions: [
        {
          id: 'budget_state',
          q: 'What are you working from now?',
          options: [
            { v: 'model', label: 'A model that works, needs updating' },
            { v: 'inherited', label: 'A spreadsheet someone else built' },
            { v: 'nothing', label: 'Starting more or less from scratch' }
          ]
        }
      ],
      price: function (a) {
        var entities = Math.max(1, parseInt(a.entities, 10) || 1);
        var stateF =
          a.budget_state === 'model' ? 0.8 : a.budget_state === 'nothing' ? 1.15 : 1;

        /* Priced per entity, not per programme. A budget with six departments
           and a pile of tracking codes is more work than one with three, but
           not enough to price separately, and nobody should have to count
           their cost centres to find out what this costs. */
        var lines = [
          {
            label:
              'Annual Budget Build, ' + entities + ' ' +
              (entities === 1 ? 'entity' : 'entities') +
              ' at $' + money(RATES.budgetBase) + ' each',
            amount: Math.round(RATES.budgetBase * entities * stateF)
          }
        ];

        var notes = [
          'Priced per entity, whatever sits underneath it. Departments, programmes and tracking codes do not change the fee, so a budget with six departments costs the same as one with three.',
          "You keep the model and can update it yourself. We would rather you didn't need us every year for the same thing.",
          'Book early. Most organisations want this in the three months before their balance date, and those months fill up.'
        ];

        if (a.allocation !== 'yes' && (parseInt(a.costCentres, 10) || 1) > 1) {
          lines.push({
            label: 'Working out how shared costs are split across your departments and programmes',
            amount: RATES.allocationMethodology,
            fixed: true
          });
          notes.push(
            a.allocation === 'informal'
              ? "Splitting overhead on a basis nobody wrote down is the thing funders query and boards can't defend. We document it once, after the first year it is just updated."
              : "Without an agreed way of splitting rent, admin and leadership time, a programme budget can't be defended to a funder. We build that methodology once."
          );
        }

        if (a.tracking === 'no') {
          notes.push(
            'Budgeting several programmes outside your accounting system is workable but fragile. Setting tracking up properly is a separate piece of work we would quote separately.'
          );
        }

        return {
          lines: lines,
          notes: notes,
          factors:
            a.budget_state === 'nothing'
              ? ['Building the budget structure from scratch']
              : a.budget_state === 'model'
              ? ['Working from a model that already functions']
              : []
        };
      }
    },

    {
      id: 'audit',
      name: 'Internal Audit',
      blurb: 'Testing whether what you wrote down is what actually happens.',
      uses: ['size', 'deadline'],
      questions: [
        {
          id: 'audit_areas',
          multi: true,
          q: 'Which areas do you want tested?',
          hint: 'Select all that apply. Pick four or more and it becomes an annual programme, spread across the year, for the same money. If you are not sure where to start, financial controls and contract compliance are where the money and the funding relationship sit.',
          options: [
            {
              v: 'controls',
              label: 'Financial controls and delegations',
              sub: 'Approvals, thresholds, bank access, segregation of duties'
            },
            {
              v: 'sensitive',
              label: 'Sensitive expenditure',
              sub: 'Travel, hospitality, koha, credit cards, gifts, personal use of assets'
            },
            {
              v: 'leakage',
              label: 'Revenue and funding leakage',
              sub: 'Under-claimed contract milestones, unbilled services, rent arrears and vacancy loss'
            },
            {
              v: 'payroll',
              label: 'Payroll and Holidays Act',
              sub: 'Leave calculations, timesheets, allowances, historical liability'
            },
            {
              v: 'contract',
              label: 'Contract and funder compliance',
              sub: 'Are you delivering what the contract says, and is the reporting accurate'
            },
            {
              v: 'restricted',
              label: 'Restricted and tied funds',
              sub: 'Whether money given for a purpose was spent on that purpose'
            },
            {
              v: 'procurement',
              label: 'Procurement, conflicts and gifts',
              sub: 'Supplier selection, related parties, the interests register'
            },
            {
              v: 'files',
              label: 'Case file and service delivery review',
              sub: 'Sampling against your own standards, the way an assessor would'
            }
          ]
        },
        {
          id: 'audit_builder',
          q: 'Have we written any of the policies or built the risk register we would be testing against?',
          hint: 'This affects how we scope the testing, so that the report stays independent of anything we produced.',
          options: [
            { v: 'other', label: 'No' },
            { v: 'mixed', label: 'Some of it' },
            { v: 'us', label: 'Most of it' }
          ]
        },
        {
          id: 'audit_present',
          multi: true,
          q: 'Who would you want us to present the findings to?',
          hint: 'Select all that apply. Same findings, but each group is a separate session with its own preparation.',
          options: [
            { v: 'arc', label: 'Audit and risk committee' },
            { v: 'board', label: 'The full board' },
            { v: 'slt', label: 'Senior leadership team' },
            {
              v: 'none',
              label: 'Nobody, just send the report',
              exclusive: true
            }
          ]
        }
      ],
      price: function (a) {
        var sizeF = SIZE_FACTOR[a.size] != null ? SIZE_FACTOR[a.size] : 1;
        var lines = [];
        var notes = [];
        var factors = [];

        var picked = a.audit_areas || [];
        var areas = picked.length || 1;

        /* Four areas or more is a year's work whatever we call it, so we call
           it a programme and spread it across the year rather than landing it
           on their team at once. The price is the same either way: one
           formula, no boundary to fall off. */
        var isProgramme = areas >= RATES.auditProgrammeFrom;

        {
          /* One step down, then flat. What is shared across areas is the
             organisation-level work: structure, funding model, systems,
             engagement setup, report format. Roughly five hours, and you
             only get it once. Every area after that carries its own process
             to learn, its own people to interview, its own records and its
             own sampling. There is no reason the eighth costs less than the
             second. */
          lines.push({
            label: isProgramme
              ? 'Annual internal audit programme & ' + areas + ' areas across the year'
              : areas === 1
              ? 'Internal audit: one area'
              : 'Internal audit: ' + areas + ' areas',
            amount: Math.round(
              (RATES.internalAuditFirstArea +
                (areas - 1) * RATES.internalAuditExtraArea) *
                sizeF
            )
          });

          if (isProgramme) {
            notes.push(
              'At ' + areas + ' areas this is a year of work, so we run it as an annual programme: a plan built from your risk register, ' + areas + ' reviews spread across the year, and working papers and a written report each time that you can hand to an assessor.'
            );
            notes.push(
              'It is the same price as testing all ' + areas + ' at once. Spreading them out actually costs us more, a separate mobilisation for each review rather than one, and the annual plan is work a one-off engagement does not include. We hold the price level because a year of committed work is worth more to us than a single job, and because ' + areas + ' areas landing on your team in one go is punishing: every area means its own interviews and its own records pulled.'
            );
          }
          if (picked.indexOf('sensitive') !== -1) {
            notes.push(
              "Sensitive expenditure is where reputational damage in this sector actually comes from. Travel, hospitality, koha, credit cards and personal use of assets are small in dollar terms and large in consequence. We test against your own policy, and where you do not have one we will say so; the Auditor-General's guidance is the benchmark most funders have in mind."
            );
          }
          if (picked.indexOf('payroll') !== -1) {
            notes.push(
              'Holidays Act calculations are the most common unremediated liability we see. If there is a problem, it is usually historical, and it is better found by us than by an employee or a funder.'
            );
          }
          if (picked.indexOf('leakage') !== -1) {
            notes.push(
              'Revenue leakage tends to pay for itself. Under-claimed contract milestones, services delivered but never invoiced, rent charged below the agreed level, arrears nobody chased: the recoveries often exceed the fee.'
            );
          }
          if (picked.indexOf('restricted') !== -1) {
            notes.push(
              'Restricted funds testing matters most where money is tight, because that is exactly when tied funding gets quietly used for something else. Better that you find it.'
            );
          }
          notes.push(
            'You tell us what your controls are meant to be. We test whether that is what actually happens: sample testing against your own records, working papers you keep and can show an assessor, and a written report with findings rated by significance and a management response column your team fills in.'
          );
          notes.push(
            'The fee assumes requested evidence reaches us within five working days. Chasing records is what turns a two-week review into a two-month one, and it is the one part of the job we cannot control. Where records are incomplete we will tell you before continuing rather than quietly absorbing it.'
          );
        }

        var audiences = (a.audit_present || []).filter(function (x) { return x !== 'none'; });
        if (audiences.length > 0) {
          var LABEL = {
            arc: 'your audit and risk committee',
            board: 'your board',
            slt: 'your senior leadership team'
          };
          var named = audiences.map(function (x) { return LABEL[x]; });
          var readable =
            named.length === 1
              ? named[0]
              : named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1];
          /* A programme is one review per area across the year, so it is one
             presentation round per area. A single engagement presents once. */
          var rounds = isProgramme ? areas : 1;
          var perRound =
            RATES.presentationFirst +
            (audiences.length - 1) * RATES.presentationExtra;
          lines.push({
            label:
              'Presenting findings to ' + readable +
              (rounds > 1 ? ', after each of the ' + rounds + ' reviews across the year' : ''),
            amount: perRound * rounds,
            fixed: true
          });
          if (audiences.length > 1) {
            notes.push(
              'Same findings, but each group hears them differently. Your leadership team needs the detail and the fixes; a board or committee needs what matters, what it means, and what happens next. We prepare for the room we are in.'
            );
          }
        } else if ((a.audit_present || []).indexOf('none') !== -1) {
          notes.push(
            'Report only, no presentation. That is fine, though findings tend to land better when someone can be asked questions in the room. The offer stays open if you change your mind.'
          );
        }

        if (a.audit_builder === 'us' || a.audit_builder === 'mixed') {
          factors.push(
            'Independence: we would be testing against criteria we helped write'
          );
          notes.push(
            a.audit_builder === 'us'
              ? 'Worth raising before you engage us. Where we wrote the policies, we should not also be the ones testing against them: that is a self-review threat, and it weakens the report exactly where you need it strongest. We would either scope this to areas we have not touched, or help you find an independent reviewer. We will tell you which when we talk.'
              : 'Where we have written some of the policies in scope, we will limit our testing to the areas we have not, and say so in the report. Independence is easier to protect than to explain afterwards.'
          );
        }

        notes.push(
          'This is internal audit delivered as advisory work. It is not an assurance engagement, and it does not replace your external statutory audit/review.'
        );

        return { lines: lines, notes: notes, factors: factors };
      }
    },

    {
      id: 'accreditation',
      name: 'Accreditation & Certification Readiness',
      blurb: 'Social services and health. We get you ready for assessment, we do not grant it.',
      uses: ['frameworks', 'ssasLevel', 'otApproval', 'size', 'deadline'],
      questions: [
        {
          id: 'acc_stage',
          q: 'Where are you up to?',
          options: [
            { v: 'first', label: 'Seeking accreditation for the first time' },
            { v: 'renewal', label: 'Renewing existing accreditation' },
            { v: 'maintain', label: 'Accredited, want to stay on top of it' }
          ]
        }
      ],
      price: function (a) {
        var fw = (a.frameworks || []).filter(function (x) { return x !== 'none'; });
        var n = Math.min(fw.length, 2);
        var sizeF = SIZE_FACTOR[a.size] != null ? SIZE_FACTOR[a.size] : 1;
        var levelF = fw.indexOf('ssas') !== -1
          ? (LEVEL_FACTOR[a.ssasLevel] != null ? LEVEL_FACTOR[a.ssasLevel] : 1)
          : 1;
        var wantsOT = fw.indexOf('ssas') !== -1 && a.otApproval === 'yes';

        var factors = [];
        if (n === 2) {
          factors.push('Preparing against both the Social Sector Accreditation Standards and Ngā Paerewa');
        }
        if (fw.indexOf('ssas') !== -1 && LEVEL_LABEL[a.ssasLevel]) {
          factors.push('Assessment at ' + LEVEL_LABEL[a.ssasLevel]);
        }

        if (a.acc_stage === 'maintain') {
          return {
            lines: [
              {
                label: 'Accreditation Gap Analysis',
                amount: Math.round(
                  RATES.accredGapAnalysis * sizeF * levelF * FRAMEWORK_FACTOR[n]
                )
              }
            ],
            factors: factors,
            notes: [
              'Staying accredited between reviews often works better as a small ongoing retainer than a one-off piece. Worth raising when we talk.',
              "We get you ready for assessment; we don't grant accreditation or issue certification, and we are not a Designated Auditing Agency."
            ]
          };
        }

        var first = a.acc_stage === 'first';
        var renewing = a.acc_stage === 'renewal';
        var base = first
          ? RATES.accredFullPrep
          : RATES.accredGapAnalysis + (renewing ? RATES.accredRenewalSupport : 0);
        var amount = base * sizeF * levelF * FRAMEWORK_FACTOR[n];

        var notes = first
          ? [
              'First-time accreditation is a bigger piece than a renewal; there is usually no existing evidence base to work from.'
            ]
          : [];

        /* Stated on every accreditation quote. In a regulated sector the
           distinction between preparing and certifying is not a nicety. */
        notes.push(
          fw.indexOf('paerewa') !== -1
            ? "We get you ready for assessment; we don't grant accreditation or issue certification. Te Kāhui Kāhu grants accreditation on behalf of its partner agencies, and certification against Ngā Paerewa is issued by HealthCERT after an audit by a Designated Auditing Agency you engage separately. We are not a Designated Auditing Agency and we don't audit."
            : "We get you ready for assessment; we don't grant accreditation. That decision sits with Te Kāhui Kāhu, who assess on behalf of their partner agencies at no charge to you."
        );

        var lines = [
          {
            label: first
              ? 'Full accreditation preparation'
              : 'Accreditation Gap Analysis and renewal support',
            amount: Math.round(amount)
          }
        ];
        if (wantsOT) {
          lines.push({
            label: 'Oranga Tamariki care partner approval support',
            amount: OT_APPROVAL_FEE,
            fixed: true
          });
          notes = notes.concat([
            'Care partner approval is granted by Oranga Tamariki, and it sits on top of Level 1 accreditation from Te Kāhui Kāhu rather than replacing it. What the fee covers is the ground accreditation does not: caregiver recruitment, assessment and approval, caregiver support and training, care planning, and monitoring and visiting. We write those policies and procedures and assemble the evidence against the National Care Standards regulations. Governance, complaints and safety checking come out of the accreditation preparation running alongside it.'
          ]);
        }

        return { lines: lines, factors: factors, notes: notes };
      }
    },

    {
      id: 'chp',
      name: 'Community Housing Registration',
      blurb: 'Getting registered with CHRA, and staying compliant.',
      uses: ['size', 'deadline'],
      questions: [
        {
          id: 'chp_stage',
          q: 'Where are you up to with CHRA registration?',
          options: [
            { v: 'exploring', label: 'Considering whether to apply' },
            { v: 'applying', label: 'Preparing an application' },
            { v: 'registered', label: 'Already registered' }
          ]
        },
        {
          id: 'chp_standards',
          multi: true,
          showIf: function (a) { return a.chp_stage !== 'exploring'; },
          q: 'Which of the five performance standards do you already have evidence for?',
          hint: 'Select all that apply. CHRA assesses you against all five, so anything not ticked is evidence we would be building with you rather than assembling.',
          options: [
            {
              v: 'governance',
              label: 'Governance',
              sub: 'Board structure, delegations, conflicts, the interests register'
            },
            {
              v: 'management',
              label: 'Management',
              sub: 'Systems, staffing, risk, complaints, how the place is actually run'
            },
            {
              v: 'financial',
              label: 'Financial viability',
              sub: 'Multi-year forecasts you could put in front of a lender'
            },
            {
              v: 'tenancy',
              label: 'Tenancy management',
              sub: 'Allocations, rent setting, arrears, tenant engagement'
            },
            {
              v: 'property',
              label: 'Property and asset management',
              sub: 'A current asset management plan and maintenance planning'
            },
            { v: 'none', label: 'None of these yet', exclusive: true }
          ]
        }
      ],
      price: function (a) {
        var sizeF = SIZE_FACTOR[a.size] != null ? SIZE_FACTOR[a.size] : 1;

        if (a.chp_stage === 'exploring') {
          return {
            lines: [
              {
                label: 'CHP Registration Readiness Assessment',
                amount: RATES.chpReadiness,
                fixed: true
              }
            ],
            notes: [
              'We assess you against the five performance standards, governance, management, financial viability, tenancy management, and property and asset management, and tell you whether registration is realistic before you spend anything on the application.',
              'CHRA suggests organisations without a housing strategy delivering social housing in the next year or two consider whether registration is right for them yet. Partnering with an existing provider is sometimes the better answer, and we will say so if it is.'
            ]
          };
        }

        if (a.chp_stage === 'registered') {
          var regLines = [
            {
              label: 'Annual compliance and disclosure reporting support',
              amount: Math.round(RATES.chpAnnualCompliance * sizeF)
            }
          ];
          if ((a.chp_standards || []).indexOf('financial') === -1) {
            regLines.push({
              label: 'Financial viability model refresh',
              amount: RATES.chpViabilityModel,
              fixed: true
            });
          }
          return {
            lines: regLines,
            notes: [
              'Ongoing compliance usually works better as a retainer than an annual scramble. Worth raising when we talk.'
            ]
          };
        }

        /* Preparing an application. CHRA assesses five standards; the base
           fee assumes we are assembling evidence you already hold. Anything
           you do not hold is built from scratch, which is its own work, so it
           is charged per standard rather than as a blanket loading.
           Financial viability is excluded here because it has its own line,
           the viability model, and charging both would double up. */
        var have = (a.chp_standards || []).filter(function (x) { return x !== 'none'; });
        var BUILDABLE = ['governance', 'management', 'tenancy', 'property'];
        var missing = BUILDABLE.filter(function (x) { return have.indexOf(x) === -1; });
        var hasFinancial = have.indexOf('financial') !== -1;

        var LABEL = {
          governance: 'governance',
          management: 'management',
          tenancy: 'tenancy management',
          property: 'property and asset management'
        };

        var appLines = [
          {
            label: 'CHP registration support: application and evidence',
            amount: Math.round(RATES.chpRegistration * sizeF)
          }
        ];

        if (missing.length > 0) {
          var named = missing.map(function (x) { return LABEL[x]; });
          appLines.push({
            label:
              'Building the evidence for ' +
              (named.length === 1
                ? named[0]
                : named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1]),
            amount: missing.length * RATES.chpStandardGap,
            fixed: true
          });
        }

        if (!hasFinancial) {
          appLines.push({
            label: 'Multi-year financial viability model',
            amount: RATES.chpViabilityModel,
            fixed: true
          });
        }

        var appNotes = [];
        if (missing.length + (hasFinancial ? 0 : 1) >= 4) {
          appNotes.push(
            'With most of the five standards still to build, this is closer to setting up a housing provider than preparing an application. It is doable, and we have priced it honestly, but it is worth talking about sequencing before you commit: some of it may be worth doing whether or not you register.'
          );
        }

        return {
          lines: appLines,
          factors: missing.length > 0
            ? ['Building evidence for ' + missing.length + ' of the five performance standards']
            : [],
          notes: appNotes.concat([
            'Financial viability is one of the five performance standards and the one applications most often stall on. It is also the one we are best placed to do.',
            'CHRA aims to decide within 60 working days of a complete application, on top of preparation time. If you are working to a funding deadline, start earlier than feels necessary.',
            "Registration doesn't guarantee funding. Income-related rent subsidy contracts are at the Ministry's discretion, and we won't suggest otherwise.",
            "We prepare your application. CHRA decides on registration; we don't register or regulate anyone."
          ])
        };
      }
    }
  ];

  /* Ongoing support is a retainer, so its line is marked recurring and is
     never added into the project total. A monthly fee and a one-off fee are
     different units; summing them would produce a meaningless number. */
  SERVICES.push({
    id: 'support',
    name: 'Ongoing Finance, Risk & Assurance Support',
    blurb: 'Us alongside your team every week, not just at year end.',
    uses: [],
    questions: [
      {
        id: 'support_hours',
        q: 'How many hours a week do you need?',
        hint: 'Ten hours a week, roughly two hours a day, is our minimum. Below that we cannot know your organisation well enough to be useful, and you would be paying for us to keep re-learning it.',
        options: [
          {
            v: '10',
            label: '10 hours a week',
            sub: 'About two hours a day, our minimum engagement'
          },
          {
            v: '15',
            label: '15 hours a week',
            sub: 'About three hours a day'
          },
          {
            v: '20',
            label: '20 hours a week',
            sub: 'About four hours a day'
          }
        ]
      }
    ],
    price: function (a) {
      var hours = parseInt(a.support_hours, 10) || RATES.supportMinimumWeeklyHours;
      var monthly = hours * RATES.supportMonthlyPerWeeklyHour;

      return {
        lines: [
          {
            label: hours + ' hours a week at $' + money(RATES.supportHourlyRate) + ' an hour',
            amount: monthly,
            fixed: true,
            recurring: true
          }
        ],
        notes: [
          'Billed monthly at the same figure every month. A month is counted as 4.33 weeks, which is 52 weeks divided by 12, so months with five weeks and months with four cost you exactly the same and it comes out right across the year.',
          'That works out to ' + Math.round(hours * 52 / 12) + ' hours a month, or $' +
            money(monthly * 12) + ' a year.',
          'We work alongside whoever already does your bookkeeping and filing rather than replacing them. Either side can end the arrangement with a month of notice; we would rather you stayed because it is worth it than because you are locked in.'
        ]
      };
    }
  });

  SERVICES.push({
    id: 'india',
    name: 'NZ-India FTA',
    blurb: 'Testing whether India stacks up, structuring it properly, and staying compliant at both ends.',
    uses: ['deadline'],
    questions: [
      {
        id: 'india_angle',
        multi: true,
        q: 'What are you weighing up?',
        hint: 'Select all that apply. This is the business case before you commit a dollar, including the honest version where the answer is no.',
        options: [
          {
            v: 'market',
            label: 'Selling into India, buying from India, or a sales or service base there',
            sub: 'A business case for your bank or board: market size, landed costs, and distributor-versus-your-own-entity, modelled over three years'
          },
          {
            v: 'captive',
            label: 'A captive or shared-services unit doing work for your own business',
            sub: 'A three-year cost comparison against staying here: salaries, attrition, property, and the point an entity beats an Employer of Record'
          },
          { v: 'none', label: 'Not sure yet, or something else entirely', exclusive: true }
        ]
      },
      {
        id: 'india_entity',
        q: 'Do you need help structuring the New Zealand side of an Indian entity?',
        hint: 'The right vehicle for you (subsidiary, branch office, liaison office or LLP: a branch is taxed as a foreign company at a materially higher rate, so it matters), the intercompany agreements and transfer pricing policy you need from day one, and a model of what a rupee of Indian profit actually lands as in New Zealand after tax, withholding and imputation.',
        options: [
          { v: 'yes', label: 'Yes' },
          { v: 'no', label: 'No' }
        ]
      },
      {
        id: 'india_tp_route',
        showIf: function (a) { return (a.india_angle || []).indexOf('captive') !== -1; },
        q: 'Where does your captive sit with transfer pricing?',
        hint: 'India reset its safe harbour rules this year: a simple election can now replace a costly benchmarking study, but only if the Indian entity is genuinely low-risk, meaning work directed from New Zealand, IP owned in New Zealand, and commercial risk carried in New Zealand.',
        options: [
          { v: 'unsure', label: 'Not sure, check eligibility first', sub: 'A transfer pricing characterisation review, a clear yes or no on safe harbour' },
          { v: 'safe_harbour', label: 'We qualify for safe harbour', sub: 'Your safe harbour election, prepared and filed' },
          { v: 'full_tp', label: 'We do not qualify, or are not electing it', sub: 'Full transfer pricing documentation, holding up to Inland Revenue and India’s tax authority' },
          { v: 'none', label: 'Not needed yet' }
        ]
      },
      {
        id: 'india_compliance',
        q: 'Will you need ongoing New Zealand compliance once the entity is up and running?',
        hint: 'Your annual CFC disclosure (IR458), filed; the controlled foreign company and active business tests, checked; thin capitalisation limits on interest deductions, checked; Indian tax already paid, credited against your New Zealand bill; and the Indian entity folded into your consolidated group accounts.',
        options: [
          { v: 'yes', label: 'Yes' },
          { v: 'no', label: 'No, or not yet' }
        ]
      }
    ],
    price: function (a) {
      var lines = [];
      var notes = [];
      var angle = Array.isArray(a.india_angle) ? a.india_angle : [];

      if (angle.indexOf('market') !== -1) {
        lines.push({
          label: 'Feasibility study',
          amount: RATES.indiaFeasibility,
          fixed: true
        });
      }

      if (angle.indexOf('captive') !== -1) {
        lines.push({
          label: 'Captive unit feasibility',
          amount: RATES.indiaCaptiveFeasibility,
          fixed: true
        });
        notes.push(
          'Captive feasibility covers salary benchmarking by role and city, attrition assumptions, property and employer costs, and a three-year total cost of ownership against doing the same work here, including the point at which an entity becomes cheaper than hiring through an Employer of Record.'
        );
      }

      if (a.india_entity === 'yes') {
        lines.push({
          label: 'Entity structuring, New Zealand side',
          amount: RATES.indiaEntityStructuring,
          fixed: true
        });
      }

      if (a.india_tp_route === 'unsure') {
        lines.push({
          label: 'Transfer pricing characterisation review',
          amount: RATES.indiaTpCharacterisation,
          fixed: true
        });
      } else if (a.india_tp_route === 'safe_harbour') {
        lines.push({
          label: 'Safe harbour election',
          amount: RATES.indiaSafeHarbour,
          fixed: true
        });
        notes.push(
          'Electing safe harbour bars the Mutual Agreement Procedure under the tax treaty for that transaction: certainty in exchange for a dispute route you would likely never use. The election is filed by 30 June of the first year.'
        );
      } else if (a.india_tp_route === 'full_tp') {
        lines.push({
          label: 'Transfer pricing documentation',
          amount: RATES.indiaTpDocumentation,
          fixed: true
        });
      }

      if (a.india_compliance === 'yes') {
        lines.push({
          label: 'Ongoing New Zealand compliance, per year',
          amount: RATES.indiaOngoingCompliance,
          fixed: true
        });
      }

      return { lines: lines, notes: notes };
    }
  });

  /* ------------------------------- engine -------------------------- */

  function money(n) {
    return Math.round(n).toLocaleString('en-NZ');
  }
  function round500(n) {
    return Math.round(n / 500) * 500;
  }

  /** Questions to ask, given the selected services. Shared questions are
   *  collected once, at the end, in a stable order. */
  function questionsFor(selected) {
    var own = [];
    var sharedIds = [];
    SERVICES.filter(function (s) { return selected.indexOf(s.id) !== -1; }).forEach(function (s) {
      s.questions.forEach(function (q) {
        var copy = Object.assign({}, q);
        copy.service = s.id;
        own.push(copy);
      });
      (s.uses || []).forEach(function (id) {
        if (sharedIds.indexOf(id) === -1) sharedIds.push(id);
      });
    });
    return own.concat(
      sharedIds.map(function (id) {
        var copy = Object.assign({}, SHARED[id]);
        copy.shared = true;
        return copy;
      })
    );
  }

  /** Questions whose showIf currently passes. */
  function visibleQuestions(selected, a) {
    return questionsFor(selected).filter(function (q) {
      return !q.showIf || q.showIf(a);
    });
  }

  function compute(selected, a) {
    var groups = [];
    var factors = [];
    var notes = [];

    var recurringGroups = [];

    SERVICES.filter(function (s) { return selected.indexOf(s.id) !== -1; }).forEach(function (s) {
      var r = s.price(a, selected) || {};
      var all = r.lines || [];
      /* A monthly retainer and a one-off fee are different units, so they
         are kept apart and never added together. */
      var oneOff = all.filter(function (l) { return !l.recurring; });
      var monthly = all.filter(function (l) { return l.recurring; });
      if (oneOff.length) groups.push({ id: s.id, name: s.name, lines: oneOff });
      if (monthly.length) {
        recurringGroups.push({ id: s.id, name: s.name, lines: monthly });
      }
      (r.factors || []).forEach(function (f) { factors.push(f); });
      (r.notes || []).forEach(function (n) { notes.push(n); });
    });

    var monthlyTotal = recurringGroups.reduce(function (t, g) {
      return t + g.lines.reduce(function (x, l) { return x + l.amount; }, 0);
    }, 0);

    var subtotal = groups.reduce(function (t, g) {
      return t + g.lines.reduce(function (x, l) { return x + l.amount; }, 0);
    }, 0);

    /* Every line a published fixed price? Then this is a quote, not an
       estimate, and priority scheduling doesn't apply. Rescheduling a
       two-week register refresh isn't the disruption that compressing a
       twelve-week policy programme is, and a range whose floor sits above
       our own published price would be indefensible. */
    var allFixed =
      groups.length > 0 &&
      groups.every(function (g) {
        return g.lines.every(function (l) { return l.fixed; });
      });

    var deadlineF = allFixed ? 1 : (DEADLINE_FACTOR[a.deadline] != null ? DEADLINE_FACTOR[a.deadline] : 1);
    var combinedF = COMBINED_FACTOR[Math.min(groups.length, 4)] != null
      ? COMBINED_FACTOR[Math.min(groups.length, 4)]
      : 1;

    if (a.deadline === 'urgent') {
      factors.push('Urgent requirement: delivery inside a month');
    } else if (deadlineF > 1) {
      factors.push('Priority scheduling for a deadline inside 3 months');
    }
    if (a.deadline === 'urgent' && deadlineF > 1) {
      notes.push(
        'Urgent work is priced for the disruption rather than the hours: it displaces something already booked. Before you commit, tell us the actual date. Sometimes it is achievable at the standard fee with a small change to the sequence, and we would rather find that out than charge you for haste you do not need.'
      );
    }
    if (combinedF < 1) {
      factors.push(
        'Combined engagement, one set of meetings and one report structure, so it costs less than doing these separately'
      );
    }

    var point = subtotal * deadlineF * combinedF;

    /* Never quote under our own published prices. The loadings above can
       discount a small job below the "from" figure on the pricing page; the
       floor stops the estimator promising a number we would not honour. */
    var floor = groups.reduce(function (t, g) {
      return t + serviceFloor(g.id, a);
    }, 0);
    if (point < floor) {
      /* Show the lift as its own line. Without it the breakdown sums to less
         than the figure above it, which looks like an error to anyone who
         adds it up, and rightly so. */
      var lift = Math.round(floor - point);
      point = floor;
      if (lift > 0) {
        groups.push({
          id: '_minimum',
          name: 'Minimum engagement',
          lines: [
            {
              label: 'Adjustment up to our starting price for this work',
              amount: lift,
              fixed: true
            }
          ]
        });
      }
      notes.push(
        'This is our starting price for the work you have described. Smaller than this and it stops being worth setting up as a piece of work, so we do not quote under it.'
      );
    }

    if (point > SEQUENCING_NOTE_ABOVE) {
      notes.push(
        'This is more than most organisations take on in one year. The figure is real and every line above is a fixed price, but before you commit to any of it we would want to talk about sequencing. There is usually an order that gets the useful parts working first and spreads the cost, and some of it you may not need yet.'
      );
    }

    var low = Math.max(round500(point * 0.88), floor);
    var high = Math.max(round500(point * 1.12), low);

    return {
      groups: groups,
      recurringGroups: recurringGroups,
      monthly: monthlyTotal,
      hasOneOff: groups.length > 0,
      factors: factors,
      notes: notes,
      subtotal: subtotal,
      point: point,
      floor: floor,
      empty: groups.length === 0 && recurringGroups.length === 0,
      exact: allFixed ? Math.max(Math.round(point), floor) : null,
      tightFit: (a.deadline === 'soon' || a.deadline === 'urgent') && point > 18000,
      low: low,
      high: high
    };
  }

  function buildSummary(selected, result) {
    var names = SERVICES.filter(function (x) { return selected.indexOf(x.id) !== -1; })
      .map(function (x) { return x.name; });
    var out = [];
    out.push('Manaaki Tech, indicative estimate');
    out.push('');
    out.push('Services: ' + names.join(', '));
    out.push('');
    if (result.hasOneOff) {
      out.push(
        result.exact
          ? 'Fixed price: $' + money(result.exact) + ' + GST'
          : 'Indicative range: $' + money(result.low) + ' - $' + money(result.high) + ' + GST'
      );
    }
    if (result.monthly > 0) {
      out.push('Ongoing: $' + money(result.monthly) + ' + GST a month');
    }
    out.push('');
    result.groups.forEach(function (g) {
      out.push(g.name);
      g.lines.forEach(function (l) {
        out.push('  ' + l.label + ', $' + money(l.amount));
      });
    });
    result.recurringGroups.forEach(function (g) {
      out.push(g.name);
      g.lines.forEach(function (l) {
        out.push('  ' + l.label + ', $' + money(l.amount) + ' a month');
      });
    });
    if (result.factors.length) {
      out.push('');
      out.push('Also factored in:');
      result.factors.forEach(function (f) { out.push('  - ' + f); });
    }
    if (result.notes.length) {
      out.push('');
      result.notes.forEach(function (n) { out.push(n); });
    }
    out.push('');
    out.push(
      'All figures exclude GST, and exclude travel and accommodation. Where the work needs us on site, travel is charged at cost on top of the fee and agreed with you in writing before anything is booked.'
    );
    out.push(
      'Indicative only, based on the answers given. Our quote is fixed once scope is agreed.'
    );
    return out.join('\n');
  }

  /* -------------------------------- view --------------------------- */

  var root = document.getElementById('estimator-root');
  if (!root) return;

  var state = {
    selected: [],
    answers: {},
    stage: 'build',
    details: { name: '', org: '', email: '', note: '' },
    sending: false,
    error: '',
    result: null
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isAnswered(q) {
    var v = state.answers[q.id];
    if (q.number) return Number(v) > 0;
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }

  function answeredCount(questions) {
    return questions.filter(isAnswered).length;
  }

  function isComplete(questions) {
    return state.selected.length > 0 && questions.every(isAnswered);
  }

  function isOn(q, v) {
    var cur = state.answers[q.id];
    return q.multi ? Array.isArray(cur) && cur.indexOf(v) !== -1 : cur === v;
  }

  function canSend() {
    return Boolean(state.details.name.trim()) && EMAIL_RE.test(state.details.email.trim());
  }

  /* ------------------------------ markup --------------------------- */

  function pickerHTML() {
    var cards = SERVICES.map(function (s) {
      var on = state.selected.indexOf(s.id) !== -1;
      return (
        '<button type="button" class="es-service' + (on ? ' is-on' : '') + '"' +
        ' data-act="service" data-id="' + esc(s.id) + '" data-fk="s:' + esc(s.id) + '"' +
        ' aria-pressed="' + on + '">' +
        '<span class="es-service-name">' +
        (on ? '<span class="es-check" aria-hidden="true">&#10003;</span>' : '') +
        esc(s.name) + '</span>' +
        '<span class="es-service-blurb">' + esc(s.blurb) + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<section class="es-picker es-noprint">' +
      '<p class="es-label">What do you need help with?</p>' +
      '<div class="es-services">' + cards + '</div>' +
      (state.selected.length > 1
        ? '<p class="es-combined">Combining services costs less than commissioning them separately, one set of meetings, one report structure.</p>'
        : '') +
      '</section>'
    );
  }

  function questionsHTML(questions) {
    if (state.selected.length === 0) return '';

    var pct = questions.length
      ? (answeredCount(questions) / questions.length) * 100
      : 0;

    var items = questions.map(function (q, i) {
      if (q.number) {
        var val = state.answers[q.id] != null ? state.answers[q.id] : '';
        return (
          '<li class="es-question">' +
          '<p class="es-q"><span class="es-qnum">' + (i + 1) + '</span>' + esc(q.q) + '</p>' +
          (q.hint ? '<p class="es-hint">' + esc(q.hint) + '</p>' : '') +
          '<div class="es-numberwrap">' +
          '<input class="es-number" type="number" inputmode="numeric"' +
          ' min="' + (q.min || 1) + '" max="' + (q.max || 999) + '"' +
          ' data-num="' + esc(q.id) + '" data-fk="n:' + esc(q.id) + '"' +
          ' aria-label="' + esc(q.q) + '"' +
          ' placeholder="' + esc(q.placeholder || '') + '"' +
          ' value="' + esc(val) + '">' +
          (q.suffix ? '<span class="es-numbersuffix">' + esc(q.suffix) + '</span>' : '') +
          '</div></li>'
        );
      }

      var opts = q.options.map(function (o) {
        var on = isOn(q, o.v);
        return (
          '<button type="button" class="es-opt' + (on ? ' is-on' : '') + '"' +
          ' data-act="pick" data-q="' + esc(q.id) + '" data-v="' + esc(o.v) + '"' +
          ' data-fk="q:' + esc(q.id) + ':' + esc(o.v) + '"' +
          ' aria-pressed="' + on + '">' +
          (on && q.multi ? '<span class="es-check" aria-hidden="true">&#10003;</span>' : '') +
          esc(o.label) +
          (o.sub ? '<span class="es-opt-sub">' + esc(o.sub) + '</span>' : '') +
          '</button>'
        );
      }).join('');

      return (
        '<li class="es-question">' +
        '<p class="es-q"><span class="es-qnum">' + (i + 1) + '</span>' + esc(q.q) + '</p>' +
        (q.hint ? '<p class="es-hint">' + esc(q.hint) + '</p>' : '') +
        '<div class="es-options" role="group" aria-label="' + esc(q.q) + '">' + opts + '</div>' +
        '</li>'
      );
    }).join('');

    return (
      '<div class="es-noprint">' +
      '<div class="es-progress" aria-hidden="true">' +
      '<span class="es-progress-fill" style="width:' + pct + '%"></span>' +
      '</div>' +
      '<ol class="es-questions">' + items + '</ol>' +
      '</div>'
    );
  }

  function gateHTML(result) {
    if (result.empty) {
      return (
        '<section class="es-result">' +
        '<p class="es-result-label">Nothing to quote</p>' +
        '<p class="es-nothing">From your answers it doesn’t look like you need us right now, which is a perfectly good outcome. If you would like a second opinion on that, the first kōrero is free.</p>' +
        '<div class="es-actions"><a class="es-cta" href="/contact.html">Have a kōrero anyway</a></div>' +
        '</section>'
      );
    }

    var fields = [
      ['name', 'Your name', 'text'],
      ['org', 'Organisation', 'text'],
      ['email', 'Email', 'email']
    ].map(function (f) {
      return (
        '<label class="es-field"><span>' + esc(f[1]) + '</span>' +
        '<input type="' + f[2] + '" data-field="' + f[0] + '" value="' + esc(state.details[f[0]]) + '"></label>'
      );
    }).join('');

    return (
      '<section class="es-result">' +
      '<p class="es-result-label">Your estimate is almost ready</p>' +
      '<p class="es-note" style="margin-top:0">We do not publish prices on the page. Pop in your details and we will email your quote through, broken down line by line. Nothing goes on a mailing list.</p>' +
      '<div class="es-fields">' + fields +
      '<label class="es-field es-field--wide"><span>Anything we should know? (optional)</span>' +
      '<textarea rows="3" data-field="note">' + esc(state.details.note) + '</textarea></label>' +
      '</div>' +
      (state.error ? '<p class="es-error">' + esc(state.error) + '</p>' : '') +
      '<div class="es-actions">' +
      '<button type="button" class="es-cta" data-act="send"' + (canSend() && !state.sending ? '' : ' disabled') + '>' +
      (state.sending ? 'Sending…' : 'Email me my quote') + '</button>' +
      '</div>' +
      '<p class="es-turnaround">We will email your quote within 2 working days.</p>' +
      '</section>'
    );
  }

  function sentHTML() {
    var first = state.details.name.trim().split(' ')[0];
    return (
      '<section class="es-result">' +
      '<p class="es-result-label">Received</p>' +
      '<h2 class="es-sent-h">Thanks, ' + esc(first) + '.</h2>' +
      '<p class="es-note" style="margin-top:0">Your answers are with us. We will email you a firm, itemised quote within 2 working days, along with a note on how we would sequence it.</p>' +
      '</section>'
    );
  }

  var LEGAL =
    '<p class="es-legal"><strong>All figures exclude GST, and exclude travel and accommodation.</strong> ' +
    'Where the work needs us on site, travel is charged at cost on top of the fee and agreed with you in writing ' +
    'before anything is booked. Ranges are indicative and based on what you have told us. Our quote is fixed once ' +
    'scope is agreed, and we will flag anything falling outside it before we do the work. We prepare organisations ' +
    'for assessment; we do not grant accreditation, issue certification, or act as an auditor.</p>';

  /* ------------------------------ render --------------------------- */

  function render() {
    var active = document.activeElement;
    var focusKey = active && active.dataset ? active.dataset.fk : null;

    var questions = visibleQuestions(state.selected, state.answers);
    var complete = isComplete(questions);
    state.result = complete ? compute(state.selected, state.answers) : null;

    var html = '';
    if (state.stage !== 'sent') {
      html += pickerHTML() + questionsHTML(questions);
    }
    if (state.stage === 'build' && state.result) {
      html += gateHTML(state.result);
    } else if (state.stage === 'sent') {
      html += sentHTML();
    }
    html += LEGAL;

    root.innerHTML = '<div class="es-wrap">' + html + '</div>';

    if (focusKey) {
      var el = root.querySelector('[data-fk="' + focusKey + '"]');
      if (el) el.focus();
    }
  }

  /* ----------------------------- behaviour ------------------------- */

  function toggleService(id) {
    var i = state.selected.indexOf(id);
    if (i === -1) state.selected.push(id);
    else state.selected.splice(i, 1);
  }

  function pick(qId, v) {
    var q = visibleQuestions(state.selected, state.answers).filter(function (x) {
      return x.id === qId;
    })[0];
    if (!q) return;

    if (!q.multi) {
      state.answers[q.id] = v;
      return;
    }

    var opt = q.options.filter(function (o) { return o.v === v; })[0];
    var cur = Array.isArray(state.answers[q.id]) ? state.answers[q.id] : [];

    if (opt.exclusive) {
      state.answers[q.id] = cur.indexOf(v) !== -1 ? [] : [v];
      return;
    }
    var base = cur.filter(function (val) {
      return !q.options.filter(function (o) { return o.v === val && o.exclusive; }).length;
    });
    state.answers[q.id] =
      base.indexOf(v) !== -1
        ? base.filter(function (val) { return val !== v; })
        : base.concat([v]);
  }

  function send() {
    var body = new URLSearchParams({
      'form-name': 'estimator',
      'bot-field': '',
      name: state.details.name,
      org: state.details.org,
      email: state.details.email,
      note: state.details.note,
      estimate: state.result
        ? buildSummary(state.selected, state.result)
        : 'No estimate was generated.'
    }).toString();

    state.sending = true;
    state.error = '';
    render();

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Status ' + res.status);
        state.stage = 'sent';
      })
      .catch(function (err) {
        console.error('Estimator submission error:', err);
        state.error =
          'Sorry, that did not send. Please try again, or email us directly at support@manaakitech.com with what you need help with.';
      })
      .then(function () {
        state.sending = false;
        render();
      });
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;

    if (act === 'service') {
      toggleService(btn.dataset.id);
      render();
    } else if (act === 'pick') {
      pick(btn.dataset.q, btn.dataset.v);
      render();
    } else if (act === 'send') {
      if (canSend() && !state.sending) send();
    }
  });

  root.addEventListener('input', function (e) {
    /* Numeric answers re-render the estimate as you type. Focus is restored
       by data-fk, which puts the caret at the end, fine for a short count. */
    var numId = e.target.dataset ? e.target.dataset.num : null;
    if (numId) {
      var raw = parseInt(e.target.value, 10);
      state.answers[numId] = isNaN(raw) || raw < 0 ? '' : raw;
      render();
      return;
    }

    var field = e.target.dataset ? e.target.dataset.field : null;
    if (!field) return;
    state.details[field] = e.target.value;
    var sendBtn = root.querySelector('[data-act="send"]');
    if (sendBtn) sendBtn.disabled = !canSend() || state.sending;
  });

  render();
})();
