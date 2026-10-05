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
 *  Every rate and factor mirrors the corrected pricing model workbook
 *  (manaaki-tech-pricing-model-corrected.xlsx, Rates and Factors sheets,
 *  Oct 2026). The workbook is the source of truth: where this file and
 *  the workbook disagree, change this file.
 * ==================================================================== */

(function () {
  'use strict';

  /* ------------------------- rounding helpers ----------------------
     Every price is rounded to cents first, then DOWN to the whole
     dollar (same as Excel ROUNDDOWN, also for negatives). Rounding to
     cents first stops floating-point values like 1,897.4999... from
     giving different answers in Excel and JavaScript. */

  function cents(x) {
    return Math.round(x * 100) / 100;
  }
  function toDollars(x) {
    return Math.trunc(cents(x));
  }

  /* ------------------------------ rates ----------------------------
     Keys and amounts as the workbook's Rates sheet names them. */

  var RATES = {
    riskFramework: 2500,          /* not scaled for size */
    registerSetUp: 2800,          /* up to 20 risks; includes 1 workshop; scales with size */
    registerRefresh: 1450,        /* scales with size */
    registerReview: 950,          /* second opinion; not scaled */
    riskWorkshop: 1600,
    setUpWorkshopsIncluded: 1,    /* workshops included in the register Set-Up */
    bcpCritical: 2800,            /* scales with size */
    policyHealthCheck: 450,       /* base fee; every policy then charged at extraPolicyReview */
    extraPolicyReview: 60,
    policyReport: 600,            /* sold with every Health Check, deliberately $120/hr */
    policyReportSession: 120,     /* sold with every Health Check */
    policyUpdate: 275,
    policyDraft: 550,
    financeHealthCheck: 1450,     /* desktop read; each extra entity at extraEntity */
    financeDeepDive: 3800,
    extraEntity: 900,
    budgetBase: 3200,             /* consolidated plus one programme */
    budgetExtraCode: 650,         /* each additional programme budget */
    allocationMethodology: 1200,  /* charged once across the engagement */
    profitabilityBase: 2800,      /* up to 3 programmes */
    profitabilityIncluded: 3,
    profitabilityExtraProgramme: 450,
    internalAuditFirstArea: 4200,
    internalAuditExtraArea: 3200,
    /* Four reviews is the annual programme; 4200 + 3 x 3200 = 13800, the
       programme price, so the formula and the programme cannot drift. */
    auditProgrammeFrom: 4,
    presentationFirst: 900,
    presentationExtra: 700,
    accredGapAnalysis: 3500,      /* also the base for renewal and maintain */
    accredFullPrep: 6000,         /* first time: no existing evidence base */
    chpReadiness: 2800,
    chpRegistration: 9500,
    chpViabilityModel: 3200,
    chpAnnualCompliance: 3400,

    /* NZ-India FTA (the workbook's India sheet). */
    feasibilityBase: 7500,        /* export via distributor, one product line, one city */
    extraRegion: 2000,            /* each additional Indian state or region */
    captiveBase: 8500,
    captiveHeadcountBand: 1500,   /* each headcount band above the smallest */
    captiveExtraFunction: 900,    /* each function beyond the first */
    structuringNZ: 4500,
    jvComplexity: 2500,
    thinCapWork: 1200,
    tpBase: 4800,                 /* transfer pricing documentation, one flow */
    tpExtraStream: 1600,          /* each additional intercompany flow */
    safeHarbourElection: 2400,
    characterisationReview: 1400,
    complianceBase: 3600,         /* annual NZ compliance, one Indian entity */
    complianceExtraEntity: 1200,

    /* Ongoing support. One hour a week costs $105 x 52 / 12 = $455 a month,
       so a month is 4.333 weeks, never 4 and never 5. That way months with
       five weeks and months with four cost the client the same and it comes
       out exactly right across a year. Minimum engagement is 10 hours a
       week, roughly two hours a day. */
    supportHourlyRate: 105,
    supportMonthlyPerWeeklyHour: 455,
    supportMinimumWeeklyHours: 10
  };

  /* --------------------------- loading factors ---------------------
     Values as the workbook's Factors sheet. Derived from hours, not
     picked; re-test against real jobs. */

  /* Policy work only: mapping each policy to the standards it is assessed
     against. One regime ~20 min/policy; both regimes are genuinely
     separate exercises. */
  var FRAMEWORK_FACTOR = { 0: 1, 1: 1.15, 2: 1.35 };

  /* Accreditation preparation: one regime is the baseline, a second regime
     is a second mapping and evidence exercise. (Not the same scale as
     FRAMEWORK_FACTOR, which is about policy mapping.) */
  var ACCRED_REGIMES_FACTOR = { 1: 1, 2: 1.15 };

  /* Assessment level is the larger cost driver. Where an organisation
     holds several contracts it is assessed at the highest level. */
  var LEVEL_FACTOR = { l1: 0.85, l2: 1, l3: 1.15, l4: 1.3, unsure: 1 };
  var LEVEL_LABEL = { l1: 'Level 1', l2: 'Level 2', l3: 'Level 3', l4: 'Level 4' };

  /* Care partner approval covers ground the accreditation work does not.
     Kept from the live service; not yet in the pricing workbook. */
  var OT_APPROVAL_FEE = 6000;

  /* Rush is 5% on the whole subtotal; one-to-three months is half that,
     so a later deadline never costs more than an urgent one. No fixed
     deadline earns a 5% discount: an open deadline lets the job fill a
     quiet stretch, which is worth real money to a small practice. */
  var DEADLINE_FACTOR = { urgent: 1.05, soon: 1.025, mid: 1, later: 1, none: 0.95 };
  var SIZE_FACTOR = { xs: 0.95, s: 1, m: 1.1, l: 1.2 };

  /* A service is a CATEGORY, counted once however many items are chosen
     inside it. 8% replaces the 5%; it is not added to it. */
  var COMBINED_FACTOR = { 1: 1, 2: 0.95, 3: 0.92, 4: 0.92 };

  /* CHP registration: keyed by how many of {financial forecasts, asset
     management plan} the client already holds. */
  var CHP_GAP_FACTOR = { 2: 1, 1: 1.15, 0: 1.35 };

  /* India feasibility (non-captive routes). */
  var MODE_FACTOR = { export: 1, entity: 1.2, jv: 1.35, unsure: 1.2 };
  var KNOWLEDGE_FACTOR = { none: 1.15, contacts: 1, visited: 0.9 };
  var REGION_EXTRA = { one: 0, two: 1, several: 2, national: 3 };
  var REGULATED_FACTOR = { yes: 1.15, no: 1, unsure: 1.08 };
  var HEADCOUNT_EXTRA = { small: 0, mid: 1, large: 2, big: 3 };

  /* India transfer pricing (trading flows). */
  var TP_VALUE_FACTOR = { small: 0.9, mid: 1, large: 1.25 };
  var TP_EXISTING_FACTOR = { fresh: 1, dated: 0.75 };
  var CFC_PASSIVE_FACTOR = 1.2;

  /* Above these the estimate becomes a conversation, not a number. */
  var TALK_TO_US_GENERAL = 22000;
  var TALK_TO_US_INDIA = 30000;

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
      max: 6,
      suffix: 'entities',
      placeholder: 'e.g. 1',
      q: 'How many entities do you have?',
      hint: 'Separate legal entities, each with its own set of accounts, up to six. Not departments or programmes, which sit underneath one entity.'
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
      uses: ['size', 'deadline'],
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
              sub: 'A full Set-Up, populated with the risks you actually carry; includes one facilitated workshop'
            },
            {
              v: 'refresh',
              label: 'Review and refresh the one we have',
              sub: 'You have a register, it needs checking and bringing up to date'
            },
            {
              v: 'review',
              label: 'Review ours and tell us how it holds up',
              sub: 'A second opinion and honest comments, without rewriting it'
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
          hint: 'A register written at a desk is a list. One written in a room with the people who carry the risks is a register. Three hours, with your leadership team or your board, whichever suits. The register Set-Up already includes one.',
          options: [
            { v: 'yes', label: 'Yes, one three hour session' },
            { v: 'no', label: 'No, work from what we have' }
          ]
        }
      ],
      price: function (a) {
        var lines = [];
        var notes = [];
        var sizeF = SIZE_FACTOR[a.size] != null ? SIZE_FACTOR[a.size] : 1;

        if (a.risk_framework === 'yes') {
          /* Not scaled for size: tailored from existing templates. */
          lines.push({
            label: 'Risk Management Framework',
            amount: RATES.riskFramework
          });
          notes.push(
            'The framework is the risk management policy, the procedure written to ISO 31000:2018, and a risk register template your team can use. It does not include filling that register in with your own risks, which is the separate line above or below it. You can take either one without the other.'
          );
        }

        if (a.risk_register === 'create') {
          lines.push({
            label: 'Risk Register Set-Up, up to 20 risks',
            amount: toDollars(RATES.registerSetUp * sizeF)
          });
          notes.push(
            'The Set-Up includes one facilitated workshop: a register written in a room with the people who carry the risks, not at a desk.'
          );
        } else if (a.risk_register === 'refresh') {
          lines.push({
            label: 'Risk Register Refresh',
            amount: toDollars(RATES.registerRefresh * sizeF)
          });
          notes.push(
            'A refresh reads the existing register, re-rates the risks, finds the gaps and brings it up to date, with one revision round.'
          );
        } else if (a.risk_register === 'review') {
          /* A second opinion is a read and a memo; it does not scale. */
          lines.push({
            label: 'Risk Register Review, second opinion',
            amount: RATES.registerReview
          });
          notes.push(
            'A register is worth a second read even when it looks current. We check coverage against what actually goes wrong in your sector and test whether the ratings still reflect the controls you have. If it is in good shape we will say so, and that is a useful thing for a board to hear from someone outside.'
          );
        }

        if (a.risk_bcp === 'yes') {
          lines.push({
            label: 'Business continuity plan, critical services',
            amount: toDollars(RATES.bcpCritical * sizeF)
          });
          notes.push(
            'The continuity plan covers your critical services: what has to keep running, who does what, what you depend on outside the organisation, and how you stand things back up. The fee assumes you can tell us which services are critical and what you already have in place. Where that groundwork does not exist we will say so before starting rather than absorbing it.'
          );
        }

        /* One session, one rate, whoever is in the room. The Set-Up already
           includes one workshop, so the first one is never charged twice. */
        if (a.risk_sessions === 'yes') {
          var included = a.risk_register === 'create' ? RATES.setUpWorkshopsIncluded : 0;
          var charged = Math.max(0, 1 - included);
          lines.push({
            label: charged === 0
              ? 'Facilitated risk session, 3 hours (included in the register Set-Up)'
              : 'Facilitated risk session, 3 hours',
            amount: charged * RATES.riskWorkshop
          });
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

        /* Policy counts use normal rounding (5.5 policies -> 6). */
        var updates = Math.round(count * mix.update);
        var drafts = Math.round(count * mix.draft);
        var work = toDollars(
          (updates * RATES.policyUpdate + drafts * RATES.policyDraft) *
            sizeF *
            FRAMEWORK_FACTOR[n] *
            levelF
        );

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
              /* A base fee plus a per-policy rate; 25 policies comes to the
                 old flat $1,950. */
              label:
                'Policy Health Check, ' + count + ' ' +
                (count === 1 ? 'policy' : 'policies'),
              amount: RATES.policyHealthCheck + count * RATES.extraPolicyReview
            },
            {
              label: 'Written report and prioritised action list',
              amount: RATES.policyReport
            },
            {
              label: 'Report walkthrough session, one hour',
              amount: RATES.policyReportSession
            },
            {
              label:
                'Policy work, roughly ' + updates + ' updated' +
                (drafts > 0 ? ', ' + drafts + ' written fresh' : ''),
              amount: work
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
          /* Each entity beyond the first is a separate ledger, a separate
             reconciliation and a separate reporting line. */
          var ents = Math.min(6, Math.max(1, parseInt(a.entities, 10) || 1));
          var base = forceDeep ? RATES.financeDeepDive : RATES.financeHealthCheck;
          lines.push({
            label:
              (forceDeep ? 'Finance Deep Dive, ' : 'Financial Health Check, ') +
              ents + ' ' + (ents === 1 ? 'entity' : 'entities'),
            amount: base + (ents - 1) * RATES.extraEntity
          });

          if (a.fin_records === 'behind') {
            notes.push(
              "We have assumed a Deep Dive, since accounts a few months behind need reconciliation work a desktop read can't do."
            );
          }
        }

        /* ---- programme profitability ---- */
        if (wantsProfit) {
          /* The base covers up to three programmes; the organisation-level
             work and the allocation basis are only done once, so programmes
             beyond three are marginal. */
          var progs = Math.max(1, parseInt(a.costCentres, 10) || 1);
          var progAmount =
            RATES.profitabilityBase +
            Math.max(0, progs - RATES.profitabilityIncluded) *
              RATES.profitabilityExtraProgramme;
          lines.push({
            label:
              progs === 1
                ? 'Programme profitability, one programme'
                : 'Programme profitability, ' + progs + ' programmes',
            amount: progAmount
          });

          notes.push(
            'We look at several years for each programme, so you see the trend rather than one year that might be unusual. The base fee covers up to three programmes; each one beyond that is $' +
              money(RATES.profitabilityExtraProgramme) + ', because the allocation model only has to be built once.'
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
            amount: RATES.allocationMethodology
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
      uses: ['costCentres', 'allocation', 'tracking', 'deadline'],
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
        var stateF =
          a.budget_state === 'model' ? 0.8 : a.budget_state === 'nothing' ? 1.15 : 1;
        var progs = Math.max(1, parseInt(a.costCentres, 10) || 1);

        /* The base is the consolidated budget plus one programme; each
           further programme carries its own funder line items, reporting
           format and assumptions. The state factor applies to the base
           build, not the per-programme add-ons. */
        var lines = [
          {
            label: 'Annual Budget Build, consolidated plus one programme',
            amount: toDollars(RATES.budgetBase * stateF)
          }
        ];
        if (progs > 1) {
          lines.push({
            label:
              (progs - 1) + ' additional programme ' +
              (progs - 1 === 1 ? 'budget' : 'budgets'),
            amount: (progs - 1) * RATES.budgetExtraCode
          });
        }

        var notes = [
          "You keep the model and can update it yourself. We would rather you didn't need us every year for the same thing.",
          'Book early. Most organisations want this in the three months before their balance date, and those months fill up.'
        ];

        if (a.allocation !== 'yes' && (parseInt(a.costCentres, 10) || 1) > 1) {
          lines.push({
            label: 'Working out how shared costs are split across your departments and programmes',
            amount: RATES.allocationMethodology
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
            amount: toDollars(
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
            amount: perRound * rounds
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

        /* One regime is the baseline; a second regime is a second mapping
           and evidence exercise. (Distinct from the policy-mapping factor:
           reusing FRAMEWORK_FACTOR here would load single-regime jobs 15%
           for no reason.) */
        var regimesF = ACCRED_REGIMES_FACTOR[Math.max(1, n)] != null
          ? ACCRED_REGIMES_FACTOR[Math.max(1, n)]
          : 1;

        if (a.acc_stage === 'maintain') {
          return {
            lines: [
              {
                label: 'Accreditation Gap Analysis',
                amount: toDollars(
                  RATES.accredGapAnalysis * sizeF * levelF * regimesF
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
        var base = first ? RATES.accredFullPrep : RATES.accredGapAnalysis;
        var amount = toDollars(base * sizeF * levelF * regimesF);

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
              ? 'Full accreditation preparation, first time'
              : 'Accreditation Gap Analysis and renewal support',
            amount: amount
          }
        ];
        if (wantsOT) {
          lines.push({
            label: 'Oranga Tamariki care partner approval support',
            amount: OT_APPROVAL_FEE
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
                amount: RATES.chpReadiness
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
              amount: toDollars(RATES.chpAnnualCompliance * sizeF)
            }
          ];
          if ((a.chp_standards || []).indexOf('financial') === -1) {
            regLines.push({
              label: 'Financial viability model refresh',
              amount: RATES.chpViabilityModel
            });
          }
          return {
            lines: regLines,
            notes: [
              'Ongoing compliance usually works better as a retainer than an annual scramble. Worth raising when we talk.'
            ]
          };
        }

        /* Preparing an application. The fee loads on how much of the
           financial evidence already exists: the gap factor keys on the
           multi-year forecasts (financial viability) and the asset
           management plan, the two standards applications most often stall
           on. The viability model is its own line where no forecasts exist,
           so it is never buried in a loading. */
        var have = (a.chp_standards || []).filter(function (x) { return x !== 'none'; });
        var hasFinancial = have.indexOf('financial') !== -1;
        var hasAssetPlan = have.indexOf('property') !== -1;
        var ready = (hasFinancial ? 1 : 0) + (hasAssetPlan ? 1 : 0);
        var gapF = CHP_GAP_FACTOR[ready];
        var missing = 5 - have.length;

        var appLines = [
          {
            label: 'CHP registration support: application and evidence',
            amount: toDollars(RATES.chpRegistration * gapF * sizeF)
          }
        ];

        if (!hasFinancial) {
          appLines.push({
            label: 'Multi-year financial viability model',
            amount: RATES.chpViabilityModel
          });
        }

        var appNotes = [];
        if (missing >= 4) {
          appNotes.push(
            'With most of the five standards still to build, this is closer to setting up a housing provider than preparing an application. It is doable, and we have priced it honestly, but it is worth talking about sequencing before you commit: some of it may be worth doing whether or not you register.'
          );
        }

        return {
          lines: appLines,
          factors: missing > 0
            ? ['Building evidence for ' + missing + ' of the five performance standards']
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
        id: 'india_mode',
        q: 'Which route are you weighing up?',
        hint: 'This is the business case before you commit a dollar, including the honest version where the answer is no.',
        options: [
          {
            v: 'export',
            label: 'Selling into India through a distributor or agent',
            sub: 'Market sizing, landed costs, and whether the route stacks up'
          },
          {
            v: 'entity',
            label: 'A sales or service base of our own in India',
            sub: 'Establishment costs, employment, premises and the regulatory pathway all enter the model'
          },
          {
            v: 'jv',
            label: 'A joint venture with an Indian partner',
            sub: 'A partner to assess as well as a market'
          },
          {
            v: 'captive',
            label: 'A captive or shared-services unit doing work for our own business',
            sub: 'A three-year cost comparison against staying here: salaries, attrition, property, and the point an entity beats an Employer of Record'
          },
          {
            v: 'unsure',
            label: 'Not sure which route yet',
            sub: 'Deciding between routes is itself the work, so it is priced as an own-entity study'
          },
          {
            v: 'skip',
            label: 'We are past the feasibility stage',
            sub: 'Already decided or already operating; no study needed'
          }
        ]
      },
      {
        id: 'india_knowledge',
        showIf: function (a) {
          return a.india_mode && a.india_mode !== 'captive' && a.india_mode !== 'skip';
        },
        q: 'How well do you know the Indian market?',
        options: [
          { v: 'none', label: 'Starting cold, no real market knowledge yet' },
          { v: 'contacts', label: 'We have some contacts there' },
          { v: 'visited', label: 'Been there, have live leads' }
        ]
      },
      {
        id: 'india_regions',
        showIf: function (a) {
          return a.india_mode && a.india_mode !== 'captive' && a.india_mode !== 'skip';
        },
        q: 'How much of India are you looking at?',
        hint: 'Regulation, distribution and cost vary materially by state.',
        options: [
          { v: 'one', label: 'One city or state' },
          { v: 'two', label: 'Two states' },
          { v: 'several', label: 'Three or four states' },
          { v: 'national', label: 'National' }
        ]
      },
      {
        id: 'india_regulated',
        showIf: function (a) {
          return a.india_mode && a.india_mode !== 'captive' && a.india_mode !== 'skip';
        },
        q: 'Is your product or service in a regulated sector in India?',
        options: [
          { v: 'no', label: 'No' },
          { v: 'yes', label: 'Yes', sub: 'Licensing and regulatory pathway analysis enters the study' },
          { v: 'unsure', label: 'Not sure', sub: 'Establishing the position is itself work' }
        ]
      },
      {
        id: 'india_headcount',
        showIf: function (a) { return a.india_mode === 'captive'; },
        q: 'How big would the Indian team be?',
        options: [
          { v: 'small', label: 'Fewer than 10 people' },
          { v: 'mid', label: '10 to 30' },
          { v: 'large', label: '30 to 100' },
          { v: 'big', label: 'More than 100' }
        ]
      },
      {
        id: 'india_functions',
        showIf: function (a) { return a.india_mode === 'captive'; },
        q: 'How many functions would it cover?',
        hint: 'Software development, finance and back office, customer support: each counts as one function, with its own salary benchmarks and staffing assumptions.',
        options: [
          { v: '1', label: 'One' },
          { v: '2', label: 'Two' },
          { v: '3', label: 'Three' },
          { v: '4', label: 'Four or more' }
        ]
      },
      {
        id: 'india_entity',
        q: 'Do you need help structuring the New Zealand side of an Indian entity?',
        hint: 'The right vehicle for you, the intercompany agreements and transfer pricing policy you need from day one, and a model of what a rupee of Indian profit actually lands as in New Zealand after tax, withholding and imputation. Indian filings are the partner firm’s work.',
        options: [
          { v: 'yes', label: 'Yes' },
          { v: 'no', label: 'No' }
        ]
      },
      {
        id: 'india_vehicle',
        showIf: function (a) { return a.india_entity === 'yes'; },
        q: 'Which vehicle are you leaning towards?',
        options: [
          { v: 'subsidiary', label: 'A subsidiary of our own' },
          { v: 'jv', label: 'A joint venture company', sub: 'Shareholder arrangements, deadlock, exit and profit sharing all need structuring' },
          { v: 'unsure', label: 'Not sure yet', sub: 'Priced as a subsidiary; a joint venture would be scoped on top' }
        ]
      },
      {
        id: 'india_funding',
        showIf: function (a) { return a.india_entity === 'yes'; },
        q: 'How would it be funded?',
        options: [
          { v: 'equity', label: 'Equity only' },
          { v: 'mixed', label: 'A mix of debt and equity', sub: 'Thin capitalisation limits what interest you can deduct, so the funding structure needs its own review' },
          { v: 'unsure', label: 'Not sure yet', sub: 'Deciding is the review, so priced as debt and equity' }
        ]
      },
      {
        id: 'india_tp_route',
        q: 'Where do you sit with transfer pricing?',
        hint: 'India reset its safe harbour rules this year: a simple election can now replace a costly benchmarking study, but only if the Indian entity is genuinely low-risk, meaning work directed from New Zealand, IP owned in New Zealand, and commercial risk carried in New Zealand.',
        options: [
          { v: 'unsure', label: 'Not sure where our Indian entity sits', sub: 'A transfer pricing characterisation review, a clear yes or no on safe harbour' },
          { v: 'safe_harbour', label: 'A captive that qualifies for safe harbour', sub: 'Your safe harbour election, prepared and filed' },
          { v: 'full_tp', label: 'Full documentation for the flows between the companies', sub: 'Holding up to Inland Revenue and India’s tax authority' },
          { v: 'none', label: 'Not needed yet' }
        ]
      },
      {
        id: 'india_tp_flows',
        showIf: function (a) { return a.india_tp_route === 'full_tp'; },
        q: 'How many flows run between the two companies?',
        hint: 'Goods one way, services the other, royalties, management fees: each flow carries its own functional analysis and its own benchmarking set.',
        options: [
          { v: '1', label: 'One' },
          { v: '2', label: 'Two' },
          { v: '3', label: 'Three' },
          { v: '4', label: 'Four or more' }
        ]
      },
      {
        id: 'india_tp_value',
        showIf: function (a) { return a.india_tp_route === 'full_tp'; },
        q: 'Roughly how much crosses between the companies each year?',
        options: [
          { v: 'small', label: 'Under $1m' },
          { v: 'mid', label: '$1m to $5m' },
          { v: 'large', label: 'Over $5m', sub: 'The level of scrutiny both authorities will apply rises with the value' }
        ]
      },
      {
        id: 'india_tp_existing',
        showIf: function (a) { return a.india_tp_route === 'full_tp'; },
        q: 'Do you have transfer pricing documentation already?',
        options: [
          { v: 'fresh', label: 'No, starting fresh' },
          { v: 'dated', label: 'Yes, but it is stale', sub: 'Updating rather than building' }
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
      },
      {
        id: 'india_compliance_entities',
        showIf: function (a) { return a.india_compliance === 'yes'; },
        q: 'How many Indian entities?',
        options: [
          { v: '1', label: 'One' },
          { v: '2', label: 'Two' },
          { v: '3', label: 'Three' },
          { v: '4', label: 'Four or more' }
        ]
      },
      {
        id: 'india_cfc',
        showIf: function (a) { return a.india_compliance === 'yes'; },
        q: 'What will the Indian entity mostly do?',
        options: [
          { v: 'active', label: 'Actively trade or deliver services' },
          { v: 'passive', label: 'Mostly hold assets or license IP', sub: 'Attribution analysis where the active business test may not be met' }
        ]
      }
    ],
    price: function (a) {
      var lines = [];
      var notes = [];
      var factors = [];
      var mode = a.india_mode;

      /* ---- feasibility ---- */
      if (mode === 'captive') {
        var bands = HEADCOUNT_EXTRA[a.india_headcount] || 0;
        var fns = Math.max(1, parseInt(a.india_functions, 10) || 1);
        lines.push({
          label: 'Captive unit feasibility',
          amount:
            RATES.captiveBase +
            bands * RATES.captiveHeadcountBand +
            (fns - 1) * RATES.captiveExtraFunction
        });
        notes.push(
          'Captive feasibility covers salary benchmarking by role and city, attrition assumptions, property and employer costs, and a three-year total cost of ownership against doing the same work here, including the point at which an entity becomes cheaper than hiring through an Employer of Record.'
        );
      } else if (mode && mode !== 'skip') {
        var modeF = MODE_FACTOR[mode] != null ? MODE_FACTOR[mode] : 1;
        var knowF = KNOWLEDGE_FACTOR[a.india_knowledge] != null
          ? KNOWLEDGE_FACTOR[a.india_knowledge]
          : 1;
        var regF = REGULATED_FACTOR[a.india_regulated] != null
          ? REGULATED_FACTOR[a.india_regulated]
          : 1;
        var regions = REGION_EXTRA[a.india_regions] || 0;
        lines.push({
          label: 'India feasibility study' +
            (regions > 0 ? ', across ' + (regions + 1) + ' states or regions' : ''),
          amount:
            toDollars(RATES.feasibilityBase * modeF * knowF * regF) +
            regions * RATES.extraRegion
        });
        if (mode === 'jv') {
          factors.push('Assessing a joint venture partner as well as a market');
        }
        if (mode === 'unsure') {
          notes.push(
            'Not sure which route yet is the normal starting point. Deciding between a distributor, your own entity and a partner is exactly what the study answers, so it is priced as an own-entity study.'
          );
        }
        if (a.india_regulated === 'yes') {
          factors.push('Licensing and regulatory pathway analysis');
        } else if (a.india_regulated === 'unsure') {
          factors.push('Establishing whether the sector is regulated in India');
        }
        if (a.india_knowledge === 'visited') {
          factors.push('Existing leads reduce the groundwork');
        } else if (a.india_knowledge === 'none') {
          factors.push('Building the market picture from nothing');
        }
      }

      /* ---- structuring, New Zealand side ---- */
      if (a.india_entity === 'yes') {
        var structAmount = RATES.structuringNZ;
        var structLabel = 'Entity structuring, New Zealand side';
        if (a.india_vehicle === 'jv') {
          structAmount += RATES.jvComplexity;
          structLabel += ', joint venture';
        }
        if (a.india_funding === 'mixed' || a.india_funding === 'unsure') {
          structAmount += RATES.thinCapWork;
          factors.push('Funding structure and thin capitalisation review');
        }
        lines.push({ label: structLabel, amount: structAmount });
      }

      /* ---- transfer pricing ---- */
      if (a.india_tp_route === 'unsure') {
        lines.push({
          label: 'Transfer pricing characterisation review',
          amount: RATES.characterisationReview
        });
        notes.push(
          'The characterisation review establishes whether your Indian entity is a low-risk service provider, and it is credited against whatever follows it.'
        );
      } else if (a.india_tp_route === 'safe_harbour') {
        lines.push({
          label: 'Safe harbour eligibility, election and cost base',
          amount: RATES.safeHarbourElection
        });
        notes.push(
          'Electing safe harbour bars the Mutual Agreement Procedure under the tax treaty for that transaction: certainty in exchange for a dispute route you would likely never use. The election is filed by 30 June of the first year.'
        );
      } else if (a.india_tp_route === 'full_tp') {
        var flows = Math.max(1, parseInt(a.india_tp_flows, 10) || 1);
        var valF = TP_VALUE_FACTOR[a.india_tp_value] != null
          ? TP_VALUE_FACTOR[a.india_tp_value]
          : 1;
        var existF = TP_EXISTING_FACTOR[a.india_tp_existing] != null
          ? TP_EXISTING_FACTOR[a.india_tp_existing]
          : 1;
        lines.push({
          label:
            'Transfer pricing documentation, ' +
            flows + ' ' + (flows === 1 ? 'flow' : 'flows'),
          amount: toDollars(
            (RATES.tpBase + (flows - 1) * RATES.tpExtraStream) * valF * existF
          )
        });
        if (a.india_tp_existing === 'dated') {
          factors.push('Updating existing documentation rather than building from scratch');
        }
      }

      /* ---- ongoing New Zealand compliance ---- */
      if (a.india_compliance === 'yes') {
        var ents = Math.max(1, parseInt(a.india_compliance_entities, 10) || 1);
        var cfcF = a.india_cfc === 'passive' ? CFC_PASSIVE_FACTOR : 1;
        lines.push({
          label:
            'Ongoing New Zealand compliance, per year' +
            (ents > 1 ? ', ' + ents + ' Indian entities' : ''),
          amount: toDollars((RATES.complianceBase + (ents - 1) * RATES.complianceExtraEntity) * cfcF)
        });
        if (a.india_cfc === 'passive') {
          factors.push('Attribution analysis: the active business test may not be met');
        }
      }

      return { lines: lines, notes: notes, factors: factors };
    }
  });

  /* ------------------------------- engine -------------------------- */

  function money(n) {
    return Math.round(n).toLocaleString('en-NZ');
  }
  /* A signed amount for a breakdown line: "-$632" rather than "$-632". */
  function signedMoney(n) {
    return n < 0 ? '-$' + money(-n) : '$' + money(n);
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

    /* Calculation order (workbook, Oct 2026): price each line (already
       rounded by the services with toDollars), sum to a subtotal, apply
       the deadline and combined factors to the whole subtotal, and show
       both as their own lines so the breakdown always adds up to the
       point estimate. */
    var deadlineF = DEADLINE_FACTOR[a.deadline] != null ? DEADLINE_FACTOR[a.deadline] : 1;
    var combinedF = COMBINED_FACTOR[Math.min(groups.length, 4)] != null
      ? COMBINED_FACTOR[Math.min(groups.length, 4)]
      : 1;

    if (a.deadline === 'urgent') {
      notes.push(
        'Urgent work is priced for the disruption rather than the hours: it displaces something already booked. Before you commit, tell us the actual date. Sometimes it is achievable at the standard fee with a small change to the sequence, and we would rather find that out than charge you for haste you do not need.'
      );
    }

    var point = toDollars(subtotal * deadlineF * combinedF);

    var rush = toDollars(subtotal * (deadlineF - 1));
    var discount = toDollars((subtotal + rush) * (combinedF - 1));
    var rounding = point - (subtotal + rush + discount);

    var adjustLines = [];
    if (rush !== 0) {
      adjustLines.push({
        label: a.deadline === 'urgent'
          ? 'Rush loading, needed within a month'
          : a.deadline === 'soon'
          ? 'Priority scheduling, one to three months'
          : 'Flexible timing, no fixed deadline',
        amount: rush
      });
    }
    if (discount !== 0) {
      adjustLines.push({
        label: 'Combined discount, ' + groups.length + ' services',
        amount: discount
      });
    }
    if (rounding !== 0) {
      adjustLines.push({ label: 'Rounding to whole dollars', amount: rounding });
    }
    if (adjustLines.length) {
      groups.push({ id: '_adjust', name: 'Engagement', lines: adjustLines });
    }

    /* The range brackets the point estimate: low rounded DOWN and high
       rounded UP, to a step that scales with the job so small ranges stay
       near plus or minus 12%. */
    var step = point < 3000 ? 100 : point < 10000 ? 250 : 500;
    var low = Math.floor(cents(point * 0.88) / step) * step;
    var high = Math.ceil(cents(point * 1.12) / step) * step;

    /* Above the ceiling the estimate becomes a conversation, not a
       number: engagements that size deserve scoping, not a form. */
    var cap = selected.indexOf('india') !== -1 ? TALK_TO_US_INDIA : TALK_TO_US_GENERAL;
    var overCap = point > cap;

    return {
      groups: groups,
      recurringGroups: recurringGroups,
      monthly: monthlyTotal,
      hasOneOff: groups.length > 0,
      factors: factors,
      notes: notes,
      subtotal: subtotal,
      point: point,
      overCap: overCap,
      empty: groups.length === 0 && recurringGroups.length === 0,
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
      if (result.overCap) {
        out.push(
          'Above the estimator’s range: a job this size is scoped in a conversation, not priced off a form. Point estimate for internal reference only: $' +
            money(result.point) + ' + GST.'
        );
      } else {
        out.push(
          'Indicative range: $' + money(result.low) + ' - $' + money(result.high) +
            ' + GST (point estimate $' + money(result.point) + ')'
        );
      }
    }
    if (result.monthly > 0) {
      out.push('Ongoing: $' + money(result.monthly) + ' + GST a month');
    }
    out.push('');
    result.groups.forEach(function (g) {
      out.push(g.name);
      g.lines.forEach(function (l) {
        out.push('  ' + l.label + ', ' + signedMoney(l.amount));
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

  /* The full question-and-answer trail, for the notification email: every
     question they were shown, the choices offered, and what they picked or
     typed. The estimate field carries the numbers; this carries the why. */
  function buildAnswerTrail(selected, a) {
    var out = [];
    visibleQuestions(selected, a).forEach(function (q, i) {
      out.push(i + 1 + '. ' + q.q);

      if (q.number) {
        var n = a[q.id];
        out.push(
          '   They entered: ' +
          (n === '' || n == null ? '(not answered)' : n + (q.suffix ? ' ' + q.suffix : ''))
        );
        out.push('');
        return;
      }

      out.push(
        '   Choices offered: ' +
        q.options.map(function (o) { return o.label; }).join(' / ')
      );

      var v = a[q.id];
      var chosen = q.options
        .filter(function (o) {
          return q.multi ? Array.isArray(v) && v.indexOf(o.v) !== -1 : o.v === v;
        })
        .map(function (o) { return o.label; });
      out.push('   They chose: ' + (chosen.length ? chosen.join(', ') : '(not answered)'));
      out.push('');
    });
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
          /* type="text" rather than "number": number inputs do not allow
             setSelectionRange, which render() needs to keep the caret at
             the end after each re-render. inputmode still gives phones a
             numeric keyboard, and the input handler parses out anything
             that is not a count. */
          '<input class="es-number" type="text" inputmode="numeric"' +
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
      if (el) {
        el.focus();
        /* A freshly created input starts with the caret at position 0,
           which made typing a count come out backwards. Put it at the end. */
        if (el.tagName === 'INPUT' && el.setSelectionRange) {
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }
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
        : 'No estimate was generated.',
      answers: buildAnswerTrail(state.selected, state.answers)
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
