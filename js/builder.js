/* ════════════════════════════════════════════════════
   BLUEPRINT — workout overview text
════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════
   ROUND-BY-ROUND WORKOUT OVERVIEW BUILDER
   Returns HTML rows: one row per round per movement.
   Falls back to simple list for single-round / TABATA.
════════════════════════════════════════════════════ */
// ── Movement abbreviation dictionary ──
const MOV_ABBR = {
  // Olympic lifts
  'Snatch': 'SN', 'Power Snatch': 'PSN', 'Hang Snatch': 'HSN', 'Hang Power Snatch': 'HPSN',
  'Clean': 'CL', 'Power Clean': 'PCL', 'Hang Clean': 'HCL', 'Hang Power Clean': 'HPCL',
  'Clean and Jerk': 'C&J', 'Clean & Jerk': 'C&J', 'Split Jerk': 'SJ', 'Push Jerk': 'PJ',
  // Squats
  'Back Squat': 'BS', 'Front Squat': 'FS', 'Overhead Squat': 'OHS',
  'Air Squat': 'AS', 'Goblet Squat': 'GS', 'Pistol Squat': 'Pistol',
  'Wall Ball': 'WB', 'Wall Ball Shot': 'WBS', 'Wall-ball Shot': 'WBS', 'Wall-ball': 'WB',
  // Deadlifts & hinges
  'Deadlift': 'DL', 'Romanian Deadlift': 'RDL', 'Sumo Deadlift': 'SDL',
  'Sumo Deadlift High Pull': 'SDHP', 'Kettlebell Swing': 'KBS',
  // Pressing
  'Shoulder Press': 'SP', 'Strict Press': 'StP', 'Push Press': 'PP',
  'Push-up': 'PU', 'Push Up': 'PU', 'Handstand Push-up': 'HSPU', 'Handstand Push Up': 'HSPU',
  'Knee Push-up': 'KnPU',
  'Dumbbell Bench Press': 'DBBP',
  'Dumbbell Press': 'DBP', 'Bench Press': 'BP',
  // Pulling
  'Pull-up': 'PU', 'Pull Up': 'PU', 'Kipping Pull-up': 'KPU', 'Kipping Pull Up': 'KPU',
  'Strict Pull-up': 'SPU', 'Chest to Bar': 'C2B', 'Chest-to-Bar': 'C2B',
  'Kipping Chest-to-bar Pull-up': 'KC2B', 'Kipping Chest-to-Bar': 'KC2B',
  'Muscle-up': 'MU', 'Muscle Up': 'MU', 'Ring Muscle-up': 'RMU', 'Kipping Muscle-up': 'KMU', 'Bar Muscle-up': 'BMU',
  'Toes to Bar': 'T2B', 'Toes-to-Bar': 'T2B', 'Knees to Elbow': 'K2E', 'Knees-to-Elbow': 'K2E',
  'Ring Row': 'RR', 'Inverted Row': 'IR',
  'Ring Row - Standard 45°': 'RR45', 'Ring Row - Beginner 70°': 'RR70', 'Ring Row - Advanced Parallel': 'RRAdv',
  // Cardio / mono-structural
  'Run': 'Run', 'Row': 'Row', 'Bike': 'Bike', 'Ski': 'Ski',
  'Double Under': 'DU', 'Double Unders': 'DUs', 'Double-under': 'DU', 'Single Under': 'SU',
  'Box Jump': 'BJ', 'Box Jump Over': 'BJO', 'Broad Jump': 'BrdJ',
  'Jump Rope': 'JR', 'Burpee': 'Bur', 'Burpee Box Jump': 'BBJ',
  'Burpee Pull-up': 'BPU', 'Bar Facing Burpee': 'BFB',
  // Gymnastics
  'Handstand Walk': 'HSW', 'Handstand Hold': 'HSH',
  'L-sit': 'Lsit', 'Ring Dip': 'RD', 'Bar Dip': 'BD', 'Dip': 'Dip',
  'GHD Sit-up': 'GHD', 'Sit-up': 'SU', 'AbMat Sit-up': 'AbSU',
  'Plank': 'Plank', 'Flutter Kick': 'FK',
  // Loaded carries & odd objects
  'Thruster': 'Thr', 'Farmer Carry': 'FC', 'Overhead Carry': 'OHC',
  'Sandbag Clean': 'SBC', 'Atlas Stone': 'AS',
  // Kettlebell
  'Kettlebell Clean': 'KBCl', 'Kettlebell Snatch': 'KBSN',
  'Kettlebell Press': 'KBP', 'Turkish Get-up': 'TGU',
  // Dumbbell
  'Dumbbell Snatch': 'DBSN', 'Dumbbell Clean': 'DBCl', 'Dumbbell Thruster': 'DBThr',
  'Dumbbell Lunge': 'DBL',
  // Misc
  'Rope Climb': 'RC', 'Peg Board': 'PB', 'Sled Push': 'SlP', 'Sled Pull': 'SlPl',
  'Assault Bike': 'ABike', 'Echo Bike': 'EBike',
  'Lunge': 'Lunge', 'Walking Lunge': 'WL', 'Overhead Lunge': 'OHL',
  'Step-up': 'StepUp', 'Slam Ball': 'SlBal',
  'Power Jerk': 'PwJ', 'Push Jerk': 'PJ',

  // Squat variations
  'Squat Clean': 'SC', 'Squat Snatch': 'SSN', 'Snatch Balance': 'SnBal',
  'Single-leg Squat (Pistol)': 'Pistol', 'Zercher Squat': 'ZS',
  'Bulgarian Split Squat': 'BSS',

  // Handstand variations
  'Strict Handstand Push-up': 'StHSPU', 'Kipping Handstand Push-up': 'KHSPU',
  'Kipping Deficit Handstand Push-up': 'KDefHSPU',
  'Freestanding Handstand Push-up': 'FsHSPU',
  'Chest-to-wall Handstand Push-up': 'C2WHSPU',
  'Handstand': 'HS',

  // Muscle-up variations
  'Strict Muscle-up': 'StMU', 'Strict Bar Muscle-up': 'SBMu',
  'Kipping Bar Muscle-up': 'KBMu',

  // Pull-up variations
  'Butterfly Pull-up': 'BfPU', 'L Pull-up': 'LPU',
  'Strict Chest-to-bar Pull-up': 'StC2B',

  // Toes-to-bar / knees variations
  'Kipping Toes-to-bar': 'KT2B', 'Strict Toes-to-bar': 'StT2B',
  'Strict Toes-to-rings': 'StT2R', 'Strict Knees-to-elbows': 'StK2E',
  'Hanging L-sit': 'HLsit', 'L-sit on Rings': 'RLsit',

  // Rope climb
  'Rope Climb': 'RC', 'Legless Rope Climb': 'LLRC',
  'L-sit Rope Climb': 'LRC', 'Modified Rope Climb': 'MRC',

  // Cardio / mono-structural
  'Run (per 100m)': 'Run', 'Row (per 100m)': 'Row',
  'Assault Bike (per cal)': 'ABike', 'Echo Bike (per cal)': 'EBike',
  'Ski Erg (per 100m)': 'Ski', 'Jump Rope (per 10 reps)': 'JR',
  'Single-under': 'SU', 'Wall Walk': 'WW',

  // Carries
  'Farmers Carry': 'FC', 'Dumbbell Farmers Carry': 'DBFC',
  'Kettlebell Farmers Carry': 'KBFC', 'Suitcase Carry': 'SC2',
  'Sandbag Carry': 'SbgC', 'Sandbag Over Shoulder': 'SbgOS',

  // GHD
  'GHD Back Extension': 'GHD-BE', 'GHD Hip Extension': 'GHD-HE',
  'GHD Hip and Back Extension': 'GHD-HBE',
  'GHD Hip, Back, and Hip-back Extension': 'GHD-HBE+',

  // Burpee variations
  'Burpee Box Jump-over': 'BBJo', 'Inverted Burpee': 'InvBur',

  // Other common
  'Medicine Ball Clean': 'MBC', 'Medicine-ball Clean': 'MBC',
  'Muscle Snatch': 'MuSN', 'Wall Ball': 'WB',
  'Good Morning': 'GM', 'Pendlay Row': 'PRow',
  'Pike Push-up': 'PikePU', 'Ring Push-up': 'RPU',
  'Barbell Row': 'BRow', 'Barbell Hip Thrust': 'BHT',
  'Barbell Lunge': 'BLunge', 'Barbell Walking Lunge': 'BWL',
  'Barbell Front-rack Lunge': 'BFrL', 'Barbell Romanian Deadlift': 'BRDL',
  'Hex Bar Deadlift': 'HexDL', 'Single Leg Romanian Deadlift': 'SLRDL',
  'Box Step-up': 'BSU', 'Clean and Push Jerk': 'CPJ',
  'Hang Clean and Push Jerk': 'HCPJ',

  // Dumbbell family
  'Dumbbell Deadlift': 'DBDL', 'Dumbbell Front Squat': 'DBFS',
  'Dumbbell Overhead Squat': 'DBOHS', 'Dumbbell Overhead Walking Lunge': 'DBOWL',
  'Dumbbell Front-rack Lunge': 'DBFrL', 'Dumbbell Hang Clean': 'DBHCL',
  'Dumbbell Hang Power Clean': 'DBHPCL', 'Dumbbell Power Clean': 'DBPCL',
  'Dumbbell Power Snatch': 'DBPSN', 'Dumbbell Squat Snatch': 'DBSSN',
  'Dumbbell Push Jerk': 'DBPJ', 'Dumbbell Push Press': 'DBPP',
  'Dumbbell Turkish Get-up': 'DBTGU',

  // Kettlebell family
  'Kettlebell Deadlift': 'KBDL', 'Kettlebell Front Squat': 'KBFS',
  'Kettlebell Overhead Squat': 'KBOHS', 'Kettlebell Overhead Lunge': 'KBOL',
  'Kettlebell Front-rack Lunge': 'KBFrL', 'Kettlebell Lunge': 'KBL',
  'Kettlebell Hang Clean': 'KBHCL', 'Kettlebell Hang Power Clean': 'KBHPCL',
  'Kettlebell Power Clean': 'KBPCL', 'Kettlebell Power Snatch': 'KBPSN',
  'Kettlebell Clean and Jerk': 'KBC&J', 'Kettlebell Jerk': 'KBJ',
  'Kettlebell Push Jerk': 'KBPJ', 'Kettlebell Push Press': 'KBPP',
  'Kettlebell Goblet Squat': 'KBGS', 'Kettlebell High Pull': 'KBHP',
  'Kettlebell Romanian Deadlift': 'KBRDL', 'Kettlebell Thruster': 'KBThr',
  'Kettlebell Turkish Get-up': 'KBTGU', 'Kettlebell Windmill': 'KBWM',
  'Kettlebell Swing (American)': 'KBS(Am)', 'Kettlebell Swing (Russian)': 'KBS(Ru)',

  // Single Arm Dumbbell family
  'Single Arm Dumbbell Clean': 'SADBCl', 'Single Arm Dumbbell Clean and Jerk': 'SADBCJ',
  'Single Arm Dumbbell Deadlift': 'SADBDL', 'Single Arm Dumbbell Farmers Carry': 'SADBFC',
  'Single Arm Dumbbell Front Squat': 'SADBFS', 'Single Arm Dumbbell Hang Clean': 'SADBHCL',
  'Single Arm Dumbbell Hang Power Clean': 'SADBHPCL', 'Single Arm Dumbbell Hang Snatch': 'SADBHSN',
  'Single Arm Dumbbell Jerk': 'SADBJ', 'Single Arm Dumbbell Overhead Squat': 'SADBOHS',
  'Single Arm Dumbbell Power Clean': 'SADBPCL', 'Single Arm Dumbbell Power Snatch': 'SADBPSN',
  'Single Arm Dumbbell Press': 'SADBP', 'Single Arm Dumbbell Push Jerk': 'SADBPJ',
  'Single Arm Dumbbell Push Press': 'SADBPP', 'Single Arm Dumbbell Romanian Deadlift': 'SADBRDL',
  'Single Arm Dumbbell Row': 'SADBRow', 'Single Arm Dumbbell Snatch': 'SADBSN',
  'Single Arm Dumbbell Thruster': 'SADBThr', 'Single Arm Dumbbell Turkish Get-up': 'SADBTGU',

  // Single Arm Kettlebell family
  'Single Arm Kettlebell Clean': 'SAKBCl', 'Single Arm Kettlebell Clean and Jerk': 'SAKBCJ',
  'Single Arm Kettlebell Farmers Carry': 'SAKBFC', 'Single Arm Kettlebell Front Squat': 'SAKBFS',
  'Single Arm Kettlebell Hang Clean': 'SAKBHCL', 'Single Arm Kettlebell Hang Snatch': 'SAKBHSN',
  'Single Arm Kettlebell High Pull': 'SAKBHP', 'Single Arm Kettlebell Jerk': 'SAKBJ',
  'Single Arm Kettlebell Overhead Squat': 'SAKBOHS', 'Single Arm Kettlebell Power Clean': 'SAKBPCL',
  'Single Arm Kettlebell Power Snatch': 'SAKBPSN', 'Single Arm Kettlebell Press': 'SAKBP',
  'Single Arm Kettlebell Push Jerk': 'SAKBPJ', 'Single Arm Kettlebell Push Press': 'SAKBPP',
  'Single Arm Kettlebell Romanian Deadlift': 'SAKBRDL', 'Single Arm Kettlebell Row': 'SAKBRow',
  'Single Arm Kettlebell Snatch': 'SAKBSN', 'Single Arm Kettlebell Swing': 'SAKBSw',
  'Single Arm Kettlebell Thruster': 'SAKBThr', 'Single Arm Kettlebell Turkish Get-up': 'SAKBTGU',

  // Other easy ones
  'Power Clean and Split Jerk': 'PCSJ', 'Split Clean': 'SpCl', 'Split Snatch': 'SpSN',
  'Rope Climb (Basket)': 'RC(B)', 'Rope Climb (Wrapping)': 'RC(W)',
  'Pull-over': 'PullOv', 'Sots Press': 'SotsP',
};

// ── Condensed display names for long movements ──
const MOV_SHORT = {
  // Kettlebell swing variants
  'Kettlebell Swing (American)': 'KB Swing (Am)',
  'Kettlebell Swing (Russian)':  'KB Swing (Ru)',
  'American Kettlebell Swing':   'KB Swing (Am)',
  'Russian Kettlebell Swing':    'KB Swing (Ru)',

  // Handstand push-up variants
  'Kipping Handstand Push-up':             'Kipping HSPU',
  'Strict Handstand Push-up':              'Strict HSPU',
  'Freestanding Handstand Push-up':        'FS HSPU',
  'Chest-to-wall Handstand Push-up':       'C2W HSPU',
  'Kipping Deficit Handstand Push-up':     'Kip Def HSPU',

  // Pull-up / muscle-up variants
  'Kipping Chest-to-bar Pull-up':          'Kipping C2B',
  'Strict Chest-to-bar Pull-up':           'Strict C2B',
  'Kipping Muscle-up':                     'Kipping MU',
  'Strict Muscle-up':                      'Strict MU',
  'Ring Muscle-up':                        'Ring MU',
  'Bar Muscle-up':                         'Bar MU',
  'Kipping Bar Muscle-up':                 'Kip Bar MU',
  'Strict Bar Muscle-up':                  'Strict Bar MU',
  'Butterfly Pull-up':                     'Butterfly PU',
  'Kipping Pull-up':                       'Kipping PU',
  'Strict Pull-up':                        'Strict PU',

  // Toes-to-bar variants
  'Kipping Toes-to-bar':                   'Kipping T2B',
  'Strict Toes-to-bar':                    'Strict T2B',
  'Strict Toes-to-rings':                  'Strict T2R',
  'Strict Knees-to-elbows':               'Strict K2E',

  // GHD
  'GHD Hip and Back Extension':            'GHD Hip+Back',
  'GHD Hip, Back, and Hip-back Extension': 'GHD Hip+Back',
  'GHD Back Extension':                    'GHD Back Ext',
  'GHD Hip Extension':                     'GHD Hip Ext',

  // Rope climb
  'Legless Rope Climb':                    'Legless RC',
  'L-sit Rope Climb':                      'L-sit RC',
  'Modified Rope Climb':                   'Modified RC',
  'Rope Climb (Basket)':                   'RC (Basket)',
  'Rope Climb (Wrapping)':                 'RC (Wrap)',

  // Dumbbell family
  'Dumbbell Deadlift':                     'DB Deadlift',
  'Dumbbell Front Squat':                  'DB Front Squat',
  'Dumbbell Overhead Squat':               'DB OHS',
  'Dumbbell Overhead Walking Lunge':       'DB OH Lunge',
  'Dumbbell Front-rack Lunge':             'DB FR Lunge',
  'Dumbbell Hang Clean':                   'DB Hang Clean',
  'Dumbbell Hang Power Clean':             'DB Hang PCL',
  'Dumbbell Power Clean':                  'DB Power Clean',
  'Dumbbell Power Snatch':                 'DB Power SN',
  'Dumbbell Squat Snatch':                 'DB Squat SN',
  'Dumbbell Push Jerk':                    'DB Push Jerk',
  'Dumbbell Push Press':                   'DB Push Press',
  'Dumbbell Turkish Get-up':               'DB TGU',
  'Dumbbell Farmers Carry':                'DB Farmers Carry',
  'Dumbbell Lunge':                        'DB Lunge',
  'Dumbbell Thruster':                     'DB Thruster',
  'Dumbbell Snatch':                       'DB Snatch',
  'Dumbbell Clean':                        'DB Clean',
  'Dumbbell Press':                        'DB Press',

  // Kettlebell family
  'Kettlebell Deadlift':                   'KB Deadlift',
  'Kettlebell Front Squat':                'KB Front Squat',
  'Kettlebell Overhead Squat':             'KB OHS',
  'Kettlebell Overhead Lunge':             'KB OH Lunge',
  'Kettlebell Front-rack Lunge':           'KB FR Lunge',
  'Kettlebell Hang Clean':                 'KB Hang Clean',
  'Kettlebell Hang Power Clean':           'KB Hang PCL',
  'Kettlebell Power Clean':                'KB Power Clean',
  'Kettlebell Power Snatch':               'KB Power SN',
  'Kettlebell Clean and Jerk':             'KB Clean & Jerk',
  'Kettlebell Push Jerk':                  'KB Push Jerk',
  'Kettlebell Push Press':                 'KB Push Press',
  'Kettlebell Goblet Squat':               'KB Goblet Squat',
  'Kettlebell High Pull':                  'KB High Pull',
  'Kettlebell Romanian Deadlift':          'KB RDL',
  'Kettlebell Thruster':                   'KB Thruster',
  'Kettlebell Turkish Get-up':             'KB TGU',
  'Kettlebell Windmill':                   'KB Windmill',
  'Kettlebell Farmers Carry':              'KB Farmers Carry',
  'Kettlebell Lunge':                      'KB Lunge',
  'Kettlebell Snatch':                     'KB Snatch',
  'Kettlebell Clean':                      'KB Clean',
  'Kettlebell Press':                      'KB Press',
  'Kettlebell Jerk':                       'KB Jerk',
  'Kettlebell Swing':                      'KB Swing',

  // Single Arm Dumbbell family
  'Single Arm Dumbbell Clean':             'SA DB Clean',
  'Single Arm Dumbbell Clean and Jerk':    'SA DB C&J',
  'Single Arm Dumbbell Deadlift':          'SA DB Deadlift',
  'Single Arm Dumbbell Farmers Carry':     'SA DB FC',
  'Single Arm Dumbbell Front Squat':       'SA DB FS',
  'Single Arm Dumbbell Hang Clean':        'SA DB Hang CL',
  'Single Arm Dumbbell Hang Power Clean':  'SA DB Hang PCL',
  'Single Arm Dumbbell Hang Snatch':       'SA DB Hang SN',
  'Single Arm Dumbbell Jerk':              'SA DB Jerk',
  'Single Arm Dumbbell Overhead Squat':    'SA DB OHS',
  'Single Arm Dumbbell Power Clean':       'SA DB PCL',
  'Single Arm Dumbbell Power Snatch':      'SA DB PSN',
  'Single Arm Dumbbell Press':             'SA DB Press',
  'Single Arm Dumbbell Push Jerk':         'SA DB PJ',
  'Single Arm Dumbbell Push Press':        'SA DB PP',
  'Single Arm Dumbbell Romanian Deadlift': 'SA DB RDL',
  'Single Arm Dumbbell Row':               'SA DB Row',
  'Single Arm Dumbbell Snatch':            'SA DB Snatch',
  'Single Arm Dumbbell Thruster':          'SA DB Thruster',
  'Single Arm Dumbbell Turkish Get-up':    'SA DB TGU',

  // Single Arm Kettlebell family
  'Single Arm Kettlebell Clean':           'SA KB Clean',
  'Single Arm Kettlebell Clean and Jerk':  'SA KB C&J',
  'Single Arm Kettlebell Farmers Carry':   'SA KB FC',
  'Single Arm Kettlebell Front Squat':     'SA KB FS',
  'Single Arm Kettlebell Hang Clean':      'SA KB Hang CL',
  'Single Arm Kettlebell Hang Snatch':     'SA KB Hang SN',
  'Single Arm Kettlebell High Pull':       'SA KB High Pull',
  'Single Arm Kettlebell Jerk':            'SA KB Jerk',
  'Single Arm Kettlebell Overhead Squat':  'SA KB OHS',
  'Single Arm Kettlebell Power Clean':     'SA KB PCL',
  'Single Arm Kettlebell Power Snatch':    'SA KB PSN',
  'Single Arm Kettlebell Press':           'SA KB Press',
  'Single Arm Kettlebell Push Jerk':       'SA KB PJ',
  'Single Arm Kettlebell Push Press':      'SA KB PP',
  'Single Arm Kettlebell Romanian Deadlift':'SA KB RDL',
  'Single Arm Kettlebell Row':             'SA KB Row',
  'Single Arm Kettlebell Snatch':          'SA KB Snatch',
  'Single Arm Kettlebell Swing':           'SA KB Swing',
  'Single Arm Kettlebell Thruster':        'SA KB Thruster',
  'Single Arm Kettlebell Turkish Get-up':  'SA KB TGU',

  // Barbell variants
  'Barbell Walking Lunge':                 'BB Walking Lunge',
  'Barbell Front-rack Lunge':              'BB FR Lunge',
  'Barbell Romanian Deadlift':             'BB RDL',
  'Barbell Hip Thrust':                    'BB Hip Thrust',
  'Barbell Overhead Lunge':                'BB OH Lunge',
  'Sumo Deadlift High Pull':               'SDHP',

  // Carries
  'Overhead Carry':                        'OH Carry',
  'Sandbag Over Shoulder':                 'Sandbag OS',

  // Other long names
  'Bulgarian Split Squat':                 'Bulgarian SS',
  'Single-leg Squat (Pistol)':             'Pistol Squat',
  'Single Leg Romanian Deadlift':          'SL RDL',
  'Power Clean and Split Jerk':            'PC + Split Jerk',
  'Clean and Push Jerk':                   'Clean + PJ',
  'Hang Clean and Push Jerk':              'Hang CL + PJ',
  'Hang Power Snatch':                     'Hang Power SN',
  'Hang Power Clean':                      'Hang Power CL',
  'Medicine Ball Clean':                   'Med Ball Clean',
  'Handstand Walk':                        'HS Walk',
  'Handstand Hold':                        'HS Hold',
  'Handstand Pirouette':                   'HS Pirouette',
  'Assault Bike (per cal)':                'Assault Bike',
  'Echo Bike (per cal)':                   'Echo Bike',
  'Ski Erg (per 100m)':                    'Ski Erg',
  'Run (per 100m)':                        'Run',
  'Row (per 100m)':                        'Row',
  'Jump Rope (per 10 reps)':               'Jump Rope',
  'AbMat Sit-up':                          'AbMat SU',
  'L-sit on Rings':                        'Ring L-sit',
  'Burpee Box Jump-over':                  'Burpee BJO',
  'Burpee Box Jump':                       'Burpee BJ',
  'Burpee Pull-up':                        'Burpee PU',
  'Bar Facing Burpee':                     'Bar Facing Bur',
  'Rope Climb':                            'Rope Climb',
  'Turkish Get-up':                        'TGU',
};

// Get short display name — always returns something readable
function getMovShort(name) {
  if (!name) return name;
  if (MOV_SHORT[name]) return MOV_SHORT[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(MOV_SHORT)) {
    if (k.toLowerCase() === lower) return v;
  }
  return name; // full name if no short version
}

// Get abbreviation — only for legend when 3+ movements AND name is long enough to benefit
function getMovAbbr(name, requireLong = false) {
  if (!name) return null;
  // When requireLong is true, only abbreviate names longer than 12 chars
  if (requireLong && name.length <= 12) return null;
  // Exact match first
  if (MOV_ABBR[name]) return MOV_ABBR[name];
  // Case-insensitive match
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(MOV_ABBR)) {
    if (k.toLowerCase() === lower) return v;
  }
  // No known abbreviation — return null, show full name
  return null;
}

function buildRoundByRound(block, opts = {}) {
  // opts: { dark: bool, compact: bool }
  const dark    = opts.dark || false;
  const tc      = dark ? 'rgba(255,255,255,.9)'  : 'var(--text)';
  const lc      = dark ? 'rgba(255,255,255,.55)' : 'var(--label)';
  const bc      = dark ? 'rgba(255,255,255,.1)'  : 'var(--border)';
  const mode    = block.querySelector('.b-mode').value.toUpperCase();
  const movements = [...block.querySelectorAll('.movement-block')]
    .filter(m => (m.querySelector('.m-search')?.value || '').trim() !== '');
  if (!movements.length) return '';

  const repSeq  = getLadderSequence(block);
  const rounds  = repSeq ? repSeq.length : (parseInt(block.querySelector('.b-target')?.value) || 1);

  // Collect weight sequences per movement
  const wtSeqs = movements.map(m => {
    const type = m.querySelector('.m-wt-ladder-type')?.value || 'fixed';
    return type !== 'fixed' ? getWtLadderSequence(m, rounds) : null;
  });

  // Collect rep override sequences per movement
  const repOverrideSeqs = movements.map(m => {
    const override = m.querySelector('.m-reps-override')?.value === '1';
    if (!override) return null;
    const scheme = m.querySelector('.m-reps-scheme')?.value || 'fixed';
    if (scheme === 'fixed') return 'fixed'; // fixed override — constant value
    return getMovRepsSequence(m, rounds);
  });

  const hasRepOverride = repOverrideSeqs.some(s => s !== null);

  // Check if anything varies round-to-round
  const hasVariation = repSeq || wtSeqs.some(s => s !== null) || hasRepOverride;

  if (!hasVariation || mode === 'TABATA') {
    // Simple two-column table: Reps | Movement
    const hc = dark ? 'rgba(255,255,255,.35)' : 'var(--label)';
    const lc2 = dark ? 'rgba(255,255,255,.55)' : 'var(--label)';
    const tc2 = dark ? 'rgba(255,255,255,.9)'  : 'var(--text)';
    const rb  = `border-top:1px solid ${dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.05)'};`;
    let tbl = `<div style="display:grid;grid-template-columns:auto 1fr;gap:0 0;align-items:baseline;">`;
    // Headers
    tbl += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-right:10px;">${mode==='TABATA'?'Tabata':'Reps'}</span>`;
    tbl += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-left:10px;">${t('block.movement')}</span>`;
    // Rows
    const legendItems = [];
    movements.forEach(m => {
      const n     = m.querySelector('.m-search').value;
      const abbr  = null; // simple table never abbreviates
      const short = getMovShort(n);
      if (short !== n) legendItems.push(`${short} = ${n}`);
      const r   = m.querySelector('.m-reps')?.value || '0';
      const kg  = parseFloat(m.querySelector('.m-wt')?.value) || 0;
      const ph  = kg > 0 && kg !== 999 ? getPerHandNote(n, kg) : '';
      const kgStr = kg === 999 ? ' @ Max kg' : kg > 0 ? ` @ ${kg}kg${ph?' ('+ph+')':''}` : '';
      const rStr  = mode === 'TABATA' ? '—' : r === '999' ? 'Max' : `${r}×`;
      const ovActive = m.querySelector('.m-reps-override')?.value === '1';
      const ovScheme = m.querySelector('.m-reps-scheme')?.value || 'fixed';
      const ovFmt = ovActive ? fmtMovRepsScheme(m, rounds) : null;
      const ovDisplay = ovFmt ? (ovScheme === 'fixed' ? `×${ovFmt}` : ovFmt) : null;
      const ovTag = ovDisplay ? ` <span style="color:var(--brand);font-weight:900;">(${ovDisplay})</span>` : '';
      tbl += `<span style="font-size:.73rem;font-weight:700;color:${lc2};${rb}padding:2px 10px 2px 0;">${rStr}</span>`;
      tbl += `<span style="font-size:.73rem;color:${tc2};${rb}padding:2px 0 2px 10px;">${short}${kgStr}${ovTag}</span>`;
    });
    tbl += '</div>';
    if (legendItems.length) tbl += `<div style="font-size:.6rem;color:${lc2};margin-top:5px;line-height:1.6;opacity:.75;">${legendItems.join(' · ')}</div>`;
    return tbl;
  }

  // Grid with headers: Rounds | Reps | Movement 1 | Movement 2...
  const cols = `auto auto ${movements.map(() => '1fr').join(' ')}`;
  const hc = dark ? 'rgba(255,255,255,.35)' : 'var(--label)';
  const gap = `padding-left:10px;`;
  const rowBorderBase = `border-top:1px solid ${dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.05)'};`;
  let rows = `<div style="display:grid;grid-template-columns:${cols};gap:0 0;align-items:baseline;">`;
  // Header row
  rows += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-right:8px;">${t('rd.label')}s</span>`;
  rows += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;${gap}">Reps</span>`;
  // Build legend for grid view — abbreviate only when 3+ movements (4+ columns total)
  const useAbbrGrid = movements.length >= 3;
  const gridLegend = [];
  movements.forEach((m, mi) => {
    const _gn = m.querySelector('.m-search').value;
    const _gkg = parseFloat(m.querySelector('.m-wt')?.value) || 0;
    const _gs = getMovShort(_gn);
    const _needsAbbrLeg = useAbbrGrid || _gs.length > 12;
    const _ga = _needsAbbrLeg && (_gkg > 0 || _gs.length > 12) ? getMovAbbr(_gn, false) : null;
    const _disp_leg = _ga || _gs;
    if (_disp_leg !== _gn) gridLegend.push(`${_disp_leg} = ${_gn}`);
    rows += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;${gap}">${t('block.movement')} ${mi+1}</span>`;
  });
  // Data rows
  for (let ri = 0; ri < rounds; ri++) {
    const roundReps = repSeq ? repSeq[ri] : null;
    const r    = roundReps !== null ? roundReps : (parseFloat(movements[0]?.querySelector('.m-reps')?.value) || 0);
    const rStr = r === 999 ? 'Max' : `${r}×`;
    const rb   = rowBorderBase;
    rows += `<span style="font-size:.73rem;font-weight:900;color:${hc};${rb}padding:2px 8px 2px 0;">${ri+1}</span>`;
    rows += `<span style="font-size:.73rem;font-weight:700;color:${lc};${rb}${gap}padding-top:2px;padding-bottom:2px;">${rStr}</span>`;
    movements.forEach((m, mi) => {
      const n     = m.querySelector('.m-search').value;
      const kgSeq = wtSeqs[mi];
      const kgRaw = kgSeq ? kgSeq[ri] : (parseFloat(m.querySelector('.m-wt')?.value) || 0);
      const isWeighted = kgRaw > 0;
      const _short = getMovShort(n);
      // Always abbreviate if: 3+ movements, OR name/short >12 chars (regardless of count)
      const _needsAbbr = useAbbrGrid || _short.length > 12;
      const _abbr = _needsAbbr && (isWeighted || _short.length > 12) ? getMovAbbr(n, false) : null;
      const _disp = _abbr || (_short.length <= 12 ? _short : _short);
      const ph    = kgRaw > 0 ? getPerHandNote(n, kgRaw) : '';
      const kgStr = kgRaw > 0 ? ` @ ${kgRaw}kg${ph?' ('+ph+')':''}` : '';
      // Per-movement rep override
      let ovStr = '';
      const ovSeq = repOverrideSeqs[mi];
      if (ovSeq !== null) {
        const ovReps = ovSeq === 'fixed'
          ? (parseInt(m.querySelector('.m-reps')?.value) || 0)
          : (ovSeq[ri] || 0);
        ovStr = ` (×${ovReps})`;
      }
      rows += `<span style="font-size:.73rem;color:${tc};${rb}${gap}padding-top:2px;padding-bottom:2px;">${_disp}${kgStr}<span style="color:var(--brand);font-weight:900;">${ovStr}</span></span>`;
    });
  }
  rows += '</div>';
  if (gridLegend.length) rows += `<div style="font-size:.6rem;color:${lc};margin-top:5px;line-height:1.6;opacity:.75;">${gridLegend.join(' · ')}</div>`;
  return rows;
}


function updateBlueprint() {
  const restSec = parseInt(document.getElementById('rest-duration-sec')?.value) || 0;
  const allBlocks = document.querySelectorAll('.wod-block');
  const restLabel = restSec > 0
    ? (restSec >= 60 ? `${Math.floor(restSec/60)}:${String(restSec%60).padStart(2,'0')} min` : `${restSec}s`)
    : null;
  let html = '';
  allBlocks.forEach((b, i) => {
    const mode = b.querySelector('.b-mode').value.toUpperCase();
    let g = (mode==='FORTIME') ? `${b.querySelector('.b-cap').value}m ${t('mode.cap')} / ${b.querySelector('.b-target').value} ${t('mode.rounds.short')}`
          : (mode==='AMRAP')   ? `${b.querySelector('.b-dur').value}m Duration`
          : (mode==='EMOM')    ? `${b.querySelector('.b-total-int').value} ${t('mode.intervals')} × ${b.querySelector('.b-int').value}s EMOM`
          : (mode==='EXMOM')   ? `E${b.querySelectorAll('.movement-block').length||'X'}MOM · ${b.querySelector('.b-total-int').value} ${t('mode.intervals')} × ${b.querySelector('.b-int').value}s`
          :                      `${b.querySelector('.b-tab-r').value} Rounds HIIT`;
    const cwodAcc = b.querySelector('.classic-accordion');
    const cwodSel = b.querySelector('.cwod-select');
    const cn = cwodAcc?.classList.contains('open') ? cwodSel?.value : null;
    const cnLabel = cn ? ` <span style="color:var(--accent);font-weight:900;">★ ${cn}</span>` : '';
    html += `<div style="background:var(--glass-inner);border:0.5px solid var(--glass-border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;">`;
    html += `<div style="font-size:.78rem;font-weight:800;color:var(--brand);margin-bottom:6px;">Block ${i+1} — ${mode} · ${g}${cnLabel}</div>`;
    if (mode === 'EXMOM') {
      // Show each movement with station label
      const moves = b.querySelectorAll('.movement-block');
      const stationCount = moves.length;
      moves.forEach((mv, si) => {
        const key = mv.querySelector('input[type="hidden"]')?.value || '';
        const reps = mv.querySelector('.m-reps')?.value || '0';
        const kg = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
        const kgStr = kg === 0 ? 'BW' : kg === 999 ? 'Max kg' : kg + 'kg';
        const stLabel = `${t('exmom.station')} ${si+1}`;
        html += `<div style="font-size:.73rem;color:var(--label);padding:2px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--accent);font-weight:800;">${stLabel}:</span> ${reps} ${key} @ ${kgStr}
        </div>`;
      });
    } else {
      html += buildRoundByRound(b, { dark: false });
    }
    const emomAcc = b.querySelector('.emom-accordion');
    if (emomAcc?.classList.contains('penalty-on')) {
      const pm = b.querySelector('.emom-accordion .m-search')?.value || b.querySelector('.int-key')?.value || 'Penalty';
      const ir = b.querySelector('.int-reps')?.value || '0';
      const iw = b.querySelector('.int-wt')?.value   || '0';
      const is = b.querySelector('.int-sec')?.value  || '60';
      const isBWBP = b.querySelector('.int-wt')?.disabled || MASTER_DB[b.querySelector('.int-key')?.value]?.type === 'bw';
      const iwL = isBWBP ? 'BW' : (parseFloat(iw) > 0 ? iw + 'kg' : '0kg');
      html += `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:.75rem;color:#F59E0B;display:flex;justify-content:space-between;"><span>⚡ EMOM Penalty: ${pm}</span><span>${ir} reps @ ${iwL} / ${is}s</span></div>`;
    }
    html += `</div>`;
    // Show rest between blocks
    if (restLabel && i < allBlocks.length - 1) {
      html += `<div style="text-align:center;font-size:.7rem;color:var(--accent);font-weight:800;margin:-2px 0 6px;letter-spacing:.04em;">⏸ REST ${restLabel}</div>`;
    }
  });
  document.getElementById('blueprintDisplay').innerHTML = html || `<span style="color:var(--label);font-size:.8rem;">${t('builder.add.overview')}</span>`;

  // Calculate Est. Technical Demand from prescribed reps
  let bldTdTotal = 0, bldTdReps = 0;
  document.querySelectorAll('.wod-block').forEach(b => {
    const mode = b.querySelector('.b-mode')?.value || 'fortime';
    b.querySelectorAll('.movement-block').forEach(m => {
      const key  = m.querySelector('input[type="hidden"]')?.value || '';
      const p    = MASTER_DB[key]; if (!p?.cx) return;
      const reps = parseFloat(m.querySelector('.m-reps')?.value) || 0;
      if (reps > 0) { bldTdTotal += p.cx * reps; bldTdReps += reps; }
    });
  });
  const tdRow = document.getElementById('builder-td-row');
  const tdVal = document.getElementById('builder-td-val');
  if (tdRow && tdVal) {
    if (bldTdReps > 0) {
      const avgTD  = bldTdTotal / bldTdReps;
      const tdInfo = getTDLabel(avgTD);
      tdVal.innerHTML = `<span style="color:${tdInfo.color};">${avgTD.toFixed(1)} / 5 — ${tdInfo.label}</span>`;
      tdRow.style.display = 'flex';
    } else {
      tdRow.style.display = 'none';
    }
  }

  updateTimerWodPreview();
}

/* Timer screen — compact workout card */
function updateTimerWodPreview() {
  const blocks = document.querySelectorAll('.wod-block');
  const el = document.getElementById('timerWodContent');
  if (!blocks.length) { el.innerHTML = '<span style="color:rgba(255,255,255,.35);font-size:.75rem;">No blocks added yet.</span>'; return; }
  const restSec = parseInt(document.getElementById('rest-duration-sec')?.value) || 0;
  const restLabel = restSec > 0
    ? (restSec >= 60 ? `${Math.floor(restSec/60)}:${String(restSec%60).padStart(2,'0')}` : `${restSec}s`)
    : null;
  let html = '';
  blocks.forEach((b, i) => {
    const mode = b.querySelector('.b-mode').value.toUpperCase();
    let g = (mode==='FORTIME') ? `${b.querySelector('.b-cap').value} ${t('mode.cap')} / ${b.querySelector('.b-target').value} ${t('mode.rounds.short')}`
          : (mode==='AMRAP')   ? `${b.querySelector('.b-dur').value} min AMRAP`
          : (mode==='EMOM')    ? `${b.querySelector('.b-total-int').value} ${t('mode.intervals')} × ${b.querySelector('.b-int').value}s`
          : (mode==='EXMOM')   ? `E${b.querySelectorAll('.movement-block').length||'X'}MOM · ${b.querySelector('.b-total-int').value} ${t('mode.intervals')} × ${b.querySelector('.b-int').value}s`
          :                      `${b.querySelector('.b-tab-r').value} ${t('mode.rounds.short')} · ${b.querySelector('.b-work').value}s ${t('mode.work.short')} / ${b.querySelector('.b-rest').value}s ${t('mode.rest.short')}`;
    const cwodAcc = b.querySelector('.classic-accordion');
    const cn = cwodAcc?.classList.contains('open') ? b.querySelector('.cwod-select')?.value : null;
    let movRows;
    if (mode === 'EXMOM') {
      const moves = b.querySelectorAll('.movement-block');
      movRows = Array.from(moves).map((mv, si) => {
        const key  = mv.querySelector('input[type="hidden"]')?.value || '';
        const reps = mv.querySelector('.m-reps')?.value || '0';
        const kg   = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
        const kgStr = kg === 0 ? 'BW' : kg === 999 ? 'Max kg' : kg + 'kg';
      return `<div data-station="${si}" style="font-size:.73rem;color:rgba(255,255,255,.7);padding:4px 8px;margin:2px 0;border-radius:4px;border-left:3px solid transparent;transition:background .2s,border-color .2s;">
          <span style="color:#F59E0B;font-weight:800;">${t('exmom.station')} ${si+1}:</span> ${reps} ${key} @ ${kgStr}
        </div>`;
      }).join('');
    } else {
      movRows = buildRoundByRound(b, { dark: true });
    }
    const emomAccT = b.querySelector('.emom-accordion');
    if (emomAccT?.classList.contains('penalty-on')) {
      const pm = b.querySelector('.emom-accordion .m-search')?.value || b.querySelector('.int-key')?.value || 'Penalty';
      const ir = b.querySelector('.int-reps')?.value || '0';
      const iw = b.querySelector('.int-wt')?.value   || '0';
      const is = b.querySelector('.int-sec')?.value  || '60';
      const isBWT = b.querySelector('.int-wt')?.disabled || MASTER_DB[b.querySelector('.int-key')?.value]?.type === 'bw';
      const iwL = isBWT ? 'BW' : (parseFloat(iw) > 0 ? iw + 'kg' : '0kg');
      movRows += `<div style="padding:3px 0;font-size:.73rem;display:flex;justify-content:space-between;color:#F59E0B;">
        <span>⚡ EMOM: ${pm}</span><span>${ir} @ ${iwL} / ${is}s</span>
      </div>`;
    }
    html += `<div class="timer-wod-block">
      <div class="timer-wod-block-title">Block ${i+1} — ${mode} ${g}${cn ? ` · <span style="color:var(--accent);">★ ${cn}</span>` : ''}</div>
      <div class="timer-wod-block-moves">${movRows || '<span style="color:rgba(255,255,255,.35);">No movements</span>'}</div>
    </div>`;
    // Show rest between blocks
    if (restLabel && i < blocks.length - 1) {
      html += `<div style="text-align:center;font-size:.7rem;color:var(--accent);font-weight:800;padding:4px 0;letter-spacing:.04em;">⏸ REST ${restLabel}</div>`;
    }
  });
  el.innerHTML = html;
}

function toggleTimerWod() {
  const body = document.getElementById('timerWodBody');
  const toggle = document.getElementById('timerWodToggle');
  const open = body.classList.toggle('open');
  toggle.classList.toggle('open', open);
}

/* ════════════════════════════════════════════════════
   BLOCK BUILDER
════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════
   SOFT RESET — clears workout/timer/results only.
   Keeps: Athlete Profile data, History, theme.
════════════════════════════════════════════════════ */
function softResetCurrentWorkout() {
  if (!confirm('Reset current workout? Your Profile and History will be kept.')) return;
  _activeTemplateName = '';
  if (timerItv?.cancel) timerItv.cancel(); else clearInterval(timerItv);
  releaseWakeLock();
  activeBlockIdx = -1; isRunning = false; isPaused = false;
  blockSec = 0; totalSessionSec = 0; sessionEnded = false;
  tabataRound = 1; tabataTotalRounds = 8; tabataPhase = 'work';
  emomRound = 0; emomTotalRounds = 0;
  setSwipeMode('finish');
  const trSecSoft = document.getElementById('timer-results-section');
  if (trSecSoft) { trSecSoft.style.display = 'none'; trSecSoft.innerHTML = ''; }
  // Reset timer display
  document.getElementById('timerDisplay').innerText = '00:00';
  document.getElementById('timerDisplay').className = 'timer-hidden';
  document.getElementById('roundInfo').innerText = 'READY';
  document.getElementById('emomProgress').classList.add('hidden-el');
  updateTimerRing(0, '');
  const _nb = document.getElementById('emomNextBanner'); if (_nb) { _nb.textContent=''; _nb.classList.remove('pulsing'); }
  updateTimerRing(0, '');
  const nb1 = document.getElementById('emomNextBanner'); if (nb1) { nb1.textContent=''; nb1.classList.remove('pulsing'); }
  document.getElementById('emomProgress').innerText = '';
  document.getElementById('liveTracker').classList.add('hidden-el');
  document.getElementById('liveVal').innerText = '0';
  // Reset start button
  // startPauseBtn removed — overlay handles state
  // Clear builder blocks, blueprint, and analytics results
  document.getElementById('timeline').innerHTML = '';
  document.getElementById('blueprintDisplay').innerHTML = `<span style="color:var(--label);font-size:.8rem;">${t('builder.add.overview')}</span>`;
  const tdRowReset = document.getElementById('builder-td-row');
  if (tdRowReset) tdRowReset.style.display = 'none';
  document.getElementById('results').classList.add('hidden-el');
  document.getElementById('energy-profile-section').classList.add('hidden-el');
  document.getElementById('session-match-outer').classList.add('hidden-el');
  document.getElementById('cloud-backup-section').classList.add('hidden-el');
  _lastPatternProfile = null;
  // Add a fresh empty block, close any open detail panel
  _openBlockId = null;
  _openMovBlockId = null;
  document.getElementById('block-detail-panel')?.classList.remove('open');
  document.getElementById('movement-panel')?.classList.remove('open');
  document.getElementById('template-panel')?.classList.remove('open');
  document.getElementById('movement-fab')?.classList.remove('visible');
  const blv = document.getElementById('builder-list-view');
  if (blv) { blv.style.overflow = ''; blv.style.visibility = ''; }
  // Clear box session scaling bar
  const scalingBar = document.getElementById('scaling-tier-bar');
  if (scalingBar) scalingBar.remove();
  window._activeBoxSession = null;
  // Unlock builder
  document.getElementById('builder-list-view')?.classList.remove('box-session-locked');
  renderBlockList();
  saveWorkoutState();
  // Brief visual confirmation
  const rb = document.getElementById('reset-btn');
  rb.innerText = '✓ Reset'; setTimeout(() => { rb.innerText = '⟳ Reset'; }, 1200);
}

function fullInitialReset() {
  if (timerItv?.cancel) timerItv.cancel(); else clearInterval(timerItv);
  releaseWakeLock();
  activeBlockIdx = -1; isRunning = false; isPaused = false; sessionEnded = false;
  blockSec = 0; totalSessionSec = 0; isResting = false;
  const trSec = document.getElementById('timer-results-section');
  if (trSec) { trSec.style.display = 'none'; trSec.innerHTML = ''; }
  if (_restItv) { clearInterval(_restItv); _restItv = null; }
  tabataRound = 1; tabataTotalRounds = 8; tabataPhase = 'work';
  emomRound = 0; emomTotalRounds = 0;
  document.getElementById('timerDisplay').innerText = '00:00';
  document.getElementById('timerDisplay').className = 'timer-hidden';
  document.getElementById('roundInfo').innerText = 'READY';
  document.getElementById('emomProgress').classList.add('hidden-el');
  document.getElementById('emomProgress').innerText = '';
  document.getElementById('liveTracker').classList.add('hidden-el');
  document.getElementById('liveVal').innerText = '0';
  const lr = document.getElementById('timerLastRound'); if (lr) lr.textContent = '';
  const bi = document.getElementById('timerBlockInfo'); if (bi) bi.textContent = '';
  const fab = document.getElementById('roundFab'); if (fab) fab.classList.remove('visible');
  const fabNum = document.getElementById('roundFabNum'); if (fabNum) fabNum.textContent = '0';
  const nb = document.getElementById('emomNextBanner'); if (nb) { nb.textContent=''; nb.classList.remove('pulsing'); }
  updateTimerRing(0, '');
  updateTimerOverlay();
  setSwipeMode('finish');
}

/* ════════════════════════════════════════════════════
   HIERARCHICAL BUILDER
   Data lives in hidden #timeline .wod-block divs (unchanged
   for physics/timer compatibility). The UI is re-rendered
   from those blocks whenever needed.
════════════════════════════════════════════════════ */

var _openBlockId = null;  // id of block currently shown in detail panel

/* ── addWodBlock: create block in hidden timeline + open detail ── */
function autoPopulateResultTime(blockEl) {
  const mode = blockEl.querySelector('.b-mode')?.value;
  const resM = blockEl.querySelector('.res-m');
  const resS = blockEl.querySelector('.res-s');
  if (!resM || !resS) return;
  // Never overwrite if user has manually set either time field
  if (resM.dataset.userSet === '1' || resS.dataset.userSet === '1') return;
  let newM = 0, newS = 0;
  if (mode === 'amrap') {
    newM = parseInt(blockEl.querySelector('.b-dur')?.value) || 0;
  } else if (mode === 'emom' || mode === 'exmom') {
    const ts = (parseInt(blockEl.querySelector('.b-int')?.value) || 60) * (parseInt(blockEl.querySelector('.b-total-int')?.value) || 1);
    newM = Math.floor(ts / 60); newS = ts % 60;
  } else if (mode === 'tabata') {
    const r = parseInt(blockEl.querySelector('.b-tab-r')?.value) || 8;
    const ts = r * ((parseInt(blockEl.querySelector('.b-work')?.value) || 20) + (parseInt(blockEl.querySelector('.b-rest')?.value) || 10));
    newM = Math.floor(ts / 60); newS = ts % 60;
  } else if (mode === 'fortime') {
    newM = parseInt(blockEl.querySelector('.b-cap')?.value) || 0;
  }
  resM.value = newM;
  resS.value = newS;
  syncResultPickerDisplays(blockEl);
}

function updateMaxRepsPhysics(inp, blockIdx, mvIdx) {
  // Update the hidden m-reps value for this movement with entered max reps
  const blocks = document.querySelectorAll('.wod-block');
  const block = blocks[blockIdx];
  if (!block) return;
  const moves = block.querySelectorAll('.movement-block');
  const move = moves[mvIdx];
  if (!move) return;
  const repsInp = move.querySelector('.m-reps');
  if (repsInp) {
    // Store actual value temporarily — physics will use this
    repsInp.dataset.maxRepsEntered = inp.value || '0';
  }
}
function confirmWodName() {
  const inp = document.getElementById('wodNameInput');
  const name = inp?.value?.trim() || 'Custom WOD';
  document.getElementById('wodNameModal')?.classList.remove('open');
  if (!_pendingHistoryEntry) return;
  const e = _pendingHistoryEntry; _pendingHistoryEntry = null;
  if (e.isSbSave) {
    _finishSbSave(name, e);
  } else {
    _finishSaveToHistory(name, e.pd, e.wd, e.mc, e.fb, e.td, e.rl, e.detail, e._blocksSnap, e._restSnap);
  }
}
function cancelWodName() {
  document.getElementById('wodNameModal')?.classList.remove('open');
  _pendingHistoryEntry = null;
}
function addWodBlock() {
  if (window._activeBoxSession && !window._activeBoxSession._loading) { showToast(t('toast.locked.session')); return; }
  if (!_activeTemplateName) _activeTemplateName = ''; // stays clear on manual build
  const id = 'block_' + Date.now();
  // Build the hidden block element (same structure as before — all pickers intact)
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildBlockHTML(id);
  const blockEl = wrapper.firstElementChild;
  document.getElementById('timeline').appendChild(blockEl);
  updateBlockNumbers();
  updateBlueprint();
  renderBlockList();
  openBlockDetail(id);
}

/* ── Build the full block HTML string (same fields as before) ── */
function buildBlockHTML(id) {
  return `<div class="card wod-block" id="${id}" oninput="updateBlueprint();syncDetailSummary('${id}');updateLadderPreview('${id}')">

      <!-- Classic WOD — accordion (first) -->
      <div class="accordion-section classic-accordion" id="cwod_acc_${id}">
        <div class="accordion-header" onclick="toggleAccordion('cwod_acc_${id}','cwod_body_${id}')">
          <div class="accordion-header-left"><span class="acc-icon">🏆</span><span class="acc-label">${t('acc.classic.wod')}</span></div>
          <span class="accordion-chevron">▼</span>
        </div>
        <div class="accordion-body" id="cwod_body_${id}">
          <label>${t('block.select.wod')}</label>
          <select class="cwod-select">
            <option value="">${t('block.choose.wod')}</option>
            <optgroup label="The Girls">
              <option>Amanda</option><option>Angie</option><option>Annie</option><option>Barbara</option>
              <option>Chelsea</option><option>Cindy</option><option>Diane</option><option>Elizabeth</option>
              <option>Eva</option><option>Fran</option><option>Grace</option><option>Helen</option>
              <option>Isabel</option><option>Jackie</option><option>Karen</option><option>Kelly</option>
              <option>Linda</option><option>Lynne</option><option>Mary</option><option>Nancy</option><option>Nicole</option>
            </optgroup>
            <optgroup label="The Heroes">
              <option>Abbate</option><option>Badger</option><option>Bradley</option><option>Bradshaw</option>
              <option>Bulger</option><option>Daniel</option><option>Donny</option><option>DT</option>
              <option>Hortman</option><option>Jared</option><option>Josh</option><option>JT</option>
              <option>Loredo</option><option>Manion</option><option>Michael</option><option>Murph</option>
              <option>Nate</option><option>Rahoi</option><option>Randy</option>
            </optgroup>
          </select>
          <div id="cwod_desc_${id}" style="font-size:.73rem;color:var(--label);margin-top:4px;line-height:1.5;margin-bottom:6px;"></div>
        </div>
      </div>

      <!-- Modality (second) -->
      <label>${t('block.modality')}</label>
      <select class="b-mode" onchange="updateBlockUI(this);updateBlueprint();syncDetailSummary('${id}')">
        <option value="fortime">For Time</option>
        <option value="amrap">AMRAP</option>
        <option value="emom">EMOM</option>
        <option value="exmom">EXMOM</option>
        <option value="tabata">Tabata</option>
      </select>

      <!-- Config panels -->
      <div class="b-cfg-container" style="margin-bottom:10px;">
        <div class="b-cfg b-cfg-fortime">
          <div class="field-stack">
            <label>${t('box.time.cap')}</label>${makePicker('b-cap',15,VALS.minCap,t('box.time.cap'))}
            <label>${t('box.goal.rounds')}</label>${makePicker('b-target',5,VALS.goalRnds,t('box.goal.rounds'))}
          </div>
          <!-- Ladder rep scheme -->
          <div class="ladder-section" style="margin-top:10px;">
            <label>${t('ladder.scheme')}</label>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px;">
              <button class="ladder-type-btn active" data-type="fixed" onclick="setLadderType('${id}','fixed')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--brand);background:var(--brand);color:white;font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.fixed')}</button>
              <button class="ladder-type-btn" data-type="ascending" onclick="setLadderType('${id}','ascending')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.ascending')}</button>
              <button class="ladder-type-btn" data-type="descending" onclick="setLadderType('${id}','descending')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.descending')}</button>
              <button class="ladder-type-btn" data-type="pyramid" onclick="setLadderType('${id}','pyramid')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.pyramid')}</button>
              <button class="ladder-type-btn" data-type="valley" onclick="setLadderType('${id}','valley')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.valley')}</button>
            </div>
            <input type="hidden" class="b-ladder-type" value="fixed">
            <div class="ladder-fields" style="display:none;">
              <div class="field-stack">
                <label>${t('ladder.start')}</label>${makePicker('b-ladder-start',5,VALS.reps,t('ladder.start'))}
                <label>${t('ladder.increment')}</label>${makePicker('b-ladder-inc',5,VALS.reps,t('ladder.increment'))}
              </div>
              <div class="ladder-preview" style="background:var(--glass-inner);border:0.5px solid var(--glass-border);border-radius:8px;padding:8px 10px;margin-top:4px;font-size:.76rem;font-weight:800;color:var(--brand);text-align:center;letter-spacing:.04em;"></div>
            </div>
          </div>
        </div>
        <div class="b-cfg b-cfg-amrap hidden-el">
          <div class="field-stack">
            <label>${t('result.duration')}</label>${makePicker('b-dur',10,VALS.minDur,t('result.duration'))}
          </div>
        </div>
        <div class="b-cfg b-cfg-emom hidden-el">
          <div class="field-stack">
            <label>${t('box.interval')}</label>${makePicker('b-int',60,VALS.intLen,t('box.interval'))}
            <label>${t('block.total.intervals')}</label>${makePicker('b-total-int',15,VALS.totalInt,'Total Intervals')}
          </div>
          <!-- Ladder rep scheme for EMOM -->
          <div class="ladder-section" style="margin-top:10px;">
            <label>${t('ladder.scheme')}</label>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px;">
              <button class="ladder-type-btn active" data-type="fixed" onclick="setLadderType('${id}','fixed')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--brand);background:var(--brand);color:white;font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.fixed')}</button>
              <button class="ladder-type-btn" data-type="ascending" onclick="setLadderType('${id}','ascending')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.ascending')}</button>
              <button class="ladder-type-btn" data-type="descending" onclick="setLadderType('${id}','descending')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.descending')}</button>
              <button class="ladder-type-btn" data-type="pyramid" onclick="setLadderType('${id}','pyramid')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.pyramid')}</button>
              <button class="ladder-type-btn" data-type="valley" onclick="setLadderType('${id}','valley')" style="padding:7px 4px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.62rem;font-weight:800;cursor:pointer;font-family:inherit;">${t('ladder.valley')}</button>
            </div>
            <input type="hidden" class="b-ladder-type" value="fixed">
            <div class="ladder-fields" style="display:none;">
              <div class="field-stack">
                <label>${t('ladder.start')}</label>${makePicker('b-ladder-start',1,VALS.reps,t('ladder.start'))}
                <label>${t('ladder.increment')}</label>${makePicker('b-ladder-inc',1,VALS.reps,t('ladder.increment'))}
              </div>
              <div class="ladder-preview" style="background:var(--glass-inner);border:0.5px solid var(--glass-border);border-radius:8px;padding:8px 10px;margin-top:4px;font-size:.76rem;font-weight:800;color:var(--brand);text-align:center;letter-spacing:.04em;"></div>
            </div>
          </div>
        </div>
        <div class="b-cfg b-cfg-tabata hidden-el">
          <div class="field-stack">
            <label>${t('block.work.sec')}</label>${makePicker('b-work',20,VALS.sec,'Work (seconds)')}
            <label>${t('block.rest.sec')}</label>${makePicker('b-rest',10,VALS.sec,'Rest (seconds)')}
            <label>${t('block.rounds.label')}</label>${makePicker('b-tab-r',8,VALS.tabRnds,'Rounds')}
          </div>
        </div>
        <div class="b-cfg b-cfg-exmom hidden-el">
          <div class="field-stack">
            <label>${t('box.interval')}</label>${makePicker('b-int',60,VALS.intLen,t('box.interval'))}
            <label>${t('block.total.intervals')}</label>${makePicker('b-total-int',15,VALS.totalInt,'Total Intervals')}
          </div>
          <div data-i18n="exmom.info" style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;font-size:.72rem;color:#F59E0B;">${t('exmom.info')}</div>
        </div>
      </div>

      <!-- Movements list (third) -->
      <div class="m-list"></div>

      <!-- EMOM Interruptor — accordion (last) -->
      <div class="accordion-section emom-accordion" id="emom_acc_${id}">
        <div class="accordion-header" onclick="toggleAccordion('emom_acc_${id}','emom_body_${id}')">
          <div class="emom-header-top">
            <span class="acc-icon">⚡</span>
            <span class="acc-label">${t('acc.emom.int')}</span>
            <div class="emom-toggle-wrap" onclick="event.stopPropagation();event.preventDefault();var _chk=this.querySelector('.emom-enabled');_chk.checked=!_chk.checked;toggleEmomEnabled('${id}',_chk.checked);">
              <span class="emom-toggle-label">${t('timer.active')}</span>
              <div class="emom-toggle">
                <input type="checkbox" class="emom-enabled" style="display:none">
                <span class="emom-toggle-track"></span>
              </div>
            </div>
          </div>
          <span class="accordion-chevron">▼</span>
        </div>
        <div class="accordion-body" id="emom_body_${id}">
          <div class="search-container">
            <label>${t('block.penalty.ex')}</label>
            <div class="search-wrap">
              <input type="text" class="m-search" oninput="handleSearch(this)" onfocus="wireSearchFocus(this)" placeholder="Search movement…" data-i18n-placeholder="search.movement">
              <div class="search-results"></div>
            </div>
            <input type="hidden" class="int-key">
          </div>
          <div class="field-stack">
            <label>${t('builder.reps')}</label>${makePicker('int-reps',5,VALS.reps,'Reps')}
            <label>${t('block.weight.kg')}</label>${makePicker('int-wt',0,VALS.kg,'Weight (kg)')}
            <label>${t('block.every.sec')}</label>${makePicker('int-sec',60,VALS.sec,'Every (seconds)')}
          </div>
        </div>
      </div>

      <!-- Results (hidden — used by timer + physics only) -->
      <div class="results-section" style="display:none!important;">
        <div class="field-stack res-wrap-r">
          <label>${t('result.rounds.done')}</label>${makePicker('res-r',0,VALS.rounds,t('result.rounds.done'))}
        </div>
        <div class="field-stack">
          <label class="x-label">${t('builder.extra.reps')}</label>${makePicker('res-x',0,VALS.reps,'Extra Reps')}
        </div>
        <div class="field-stack res-emom-wrap hidden-el">
          <label>${t('block.emom.penalty')}</label>${makePicker('res-emom',0,VALS.reps,'EMOM Penalty Total')}
        </div>
        <div class="res-time-wrap field-stack">
          <label>${t('result.final.time')} — min</label>${makePicker('res-m',0,VALS.finMin,'Final Time — Minutes')}
          <label>${t('result.final.time')} — sec</label>${makePicker('res-s',0,VALS.finSec,'Final Time — Seconds')}
        </div>
        <input type="hidden" class="res-mv-data" value="">
      </div>
    </div>`;
}

/* ── Analytics Results section ── */
function renderTimerResults() {
  const container = document.getElementById('timer-results-section');
  if (!container) return;
  const blocks = document.querySelectorAll('.wod-block');
  if (!blocks.length) return;

  container.style.display = 'block';
  container.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:.68rem;font-weight:900;color:var(--brand);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px;';
  hdr.textContent = t('builder.session.results');
  container.appendChild(hdr);

  blocks.forEach((block, i) => {
    const mode = block.querySelector('.b-mode')?.value || 'fortime';
    const isTabata  = mode === 'tabata';
    const isForTime = mode === 'fortime';
    const modeLabel = { fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata' }[mode] || mode;
    const hasEmom   = block.querySelector('.emom-accordion')?.classList.contains('penalty-on');

    const blockWrap = document.createElement('div');
    blockWrap.style.cssText = 'margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);';
    blockWrap.innerHTML = `<div style="font-size:.72rem;font-weight:900;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Block ${i+1} — ${modeLabel}</div>`;

    // Clone result fields from block
    const resBlock = block.querySelector('.results-section');
    if (resBlock) {
      const cloned = resBlock.cloneNode(true);
      cloned.style.display = '';
      ['res-r','res-x','res-m','res-s','res-emom'].forEach(cls => {
        const liveInp  = block.querySelector('.' + cls);
        const cloneInp = cloned.querySelector('.' + cls);
        if (liveInp && cloneInp) {
          cloneInp.value = liveInp.value;
          const trig = cloneInp.closest('.picker-trigger');
          if (trig) trig.querySelector('.picker-trigger-val').textContent =
            formatPickerVal(parseFloat(liveInp.value)||0, trig.dataset.label);
        }
      });
      cloned.querySelector('.res-time-wrap')?.classList.remove('hidden-el');
      cloned.querySelector('.res-wrap-r')?.classList.toggle('hidden-el', isTabata);
      if (!hasEmom) cloned.querySelector('.res-emom-wrap')?.classList.add('hidden-el');
      const xl = cloned.querySelector('.x-label');
      if (xl) xl.innerText = isTabata ? t('builder.total.reps') : t('builder.extra.reps');
      const rlClone1 = cloned.querySelector('.res-wrap-r label');
      if (rlClone1) rlClone1.innerText = (mode === 'emom' || mode === 'exmom') ? t('result.intervals.done') : t('result.rounds.done');
      // Re-wire pickers to write back to real block
      cloned.querySelectorAll('.picker-trigger').forEach(t => {
        const cls2 = t.querySelector('input[type="number"]')?.className?.split(' ')[0];
        if (!cls2) return;
        t.onclick = function() {
          const origInp = block.querySelector('.' + cls2);
          if (origInp) this.querySelector('input[type="number"]').value = origInp.value;
          openPickerWithCallback(this, (val) => {
            const origInp2 = block.querySelector('.' + cls2);
            if (origInp2) {
              origInp2.value = val;
              if (cls2 === 'res-m' || cls2 === 'res-s') {
                const rm = block.querySelector('.res-m');
                const rs = block.querySelector('.res-s');
                if (rm) rm.dataset.userSet = '1';
                if (rs) rs.dataset.userSet = '1';
              } else {
                origInp2.dispatchEvent(new Event('input', {bubbles:true}));
              }
            }
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, this.dataset.label);
            // Also sync analytics version if open
            if (currentTab === 3) renderAnalyticsResults();
          });
        };
      });
      blockWrap.appendChild(cloned);
    }

    // Max-weight per movement — any movement with kg=999
    {
      const maxWtMoves = [...block.querySelectorAll('.movement-block')].filter(mv =>
        parseFloat(mv.querySelector('.m-wt')?.value) === 999
      );
      if (maxWtMoves.length > 0) {
        const mvWrap = document.createElement('div');
        mvWrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
        mvWrap.innerHTML = '<div style="font-size:.68rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Max Load — Enter Results</div><div style="font-size:.68rem;color:var(--label);margin-bottom:8px;font-style:italic;">Enter heaviest load achieved for the prescribed reps</div>';
        maxWtMoves.forEach((mv, idx2) => {
          const name = mv.querySelector('.m-search')?.value || 'Movement';
          const wtInp = mv.querySelector('.m-wt');
          const stored = parseFloat(wtInp?.dataset.maxKgEntered) || '';
          const row = document.createElement('div');
          row.className = 'field-stack';
          const pickerId = 'mv-max-kg-' + i + '-' + idx2;
          row.innerHTML = `<label style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:.68rem;font-weight:800;color:var(--brand);padding:2px 8px;background:rgba(255,107,53,.12);border-radius:4px;">MAX KG</span>
            ${name}
          </label>
          ${makePicker(pickerId, stored||0, VALS.kg.filter(v => v !== 999), name + ' Max Load (kg)')}`;
          const trig = row.querySelector('.picker-trigger');
          if (trig) {
            trig.style.border = '1.5px solid var(--brand)';
            trig.style.borderRadius = 'var(--radius-sm)';
            (function(mvElement, wtInput) {
              trig.onclick = function() {
                const curVal = parseInt(this.dataset.val)||0;
                this.querySelector('input[type="number"]').value = curVal;
                openPickerWithCallback(this, (val) => {
                  this.dataset.val = val;
                  this.querySelector('.picker-trigger-val').textContent = val + ' kg';
                  if (wtInput) wtInput.dataset.maxKgEntered = val;
                  autoSave();
                  closePicker();
                });
              };
            })(mv, wtInp);
          }
          mvWrap.appendChild(row);
        });
        blockWrap.appendChild(mvWrap);
      }
    }

    // Max-reps per movement — any movement with reps=999
    {
      const maxMoves = [...block.querySelectorAll('.movement-block')].filter(mv =>
        parseFloat(mv.querySelector('.m-reps')?.value) === 999
      );
      if (maxMoves.length > 0) {
        const mvWrap = document.createElement('div');
        mvWrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
        mvWrap.innerHTML = `<div style="font-size:.68rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${t('result.max.reps.title')}</div><div style="font-size:.68rem;color:var(--label);margin-bottom:8px;font-style:italic;">${t('result.max.reps.desc')}</div>`;
        maxMoves.forEach((mv, idx2) => {
          const name = mv.querySelector('.m-search')?.value || 'Movement';
          const stored = parseFloat(mv.querySelector('.m-reps')?.dataset.maxRepsEntered) || '';
          const row = document.createElement('div');
          row.className = 'field-stack';
          const pickerId = 'mv-max-tr-' + i + '-' + idx2;
          row.innerHTML = `<label style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:.68rem;font-weight:800;color:var(--brand);padding:2px 8px;background:rgba(255,107,53,.12);border-radius:4px;">MAX</span>
            ${name}
          </label>
          ${makePicker(pickerId, stored||0, VALS.reps, name + ' Max Reps')}`;
          // Wire up picker callback to update maxRepsEntered
          const trig = row.querySelector('.picker-trigger');
          if (trig) {
            trig.style.border = '1.5px solid var(--brand)';
            trig.style.borderRadius = 'var(--radius-sm)';
            (function(mvElement) {
              trig.onclick = function() {
                const curVal = parseInt(this.dataset.val)||0;
                this.querySelector('input[type="number"]').value = curVal;
                openPickerWithCallback(this, (val) => {
                  this.dataset.val = val;
                  this.querySelector('.picker-trigger-val').textContent = val === 999 ? t('builder.max.reps') : val + ' reps';
                  if (mvElement?.querySelector('.m-reps')) mvElement.querySelector('.m-reps').dataset.maxRepsEntered = val;
                  autoSave();
                });
              };
            })(mv);
          }
          mvWrap.appendChild(row);
        });
        blockWrap.appendChild(mvWrap);
      }
    }
    container.appendChild(blockWrap);
  });

  // RPE — same requirement as the Analytics simulation flow, but this is
  // the actual, normal way most sessions get calculated (right after the
  // timer finishes), so it needs its own slider here too. Kept as a
  // separate element from the per-block sliders (this section and the
  // Analytics one can both exist in the DOM at once); its value is a
  // quick single "how did that feel" rating that seeds every block's
  // individual slider on Calculate — see the Calculate Physics button
  // below — rather than replacing per-block granularity entirely.
  const rpeWrap = document.createElement('div');
  rpeWrap.style.cssText = 'margin-top:4px;padding-top:14px;border-top:1px solid var(--border);';
  rpeWrap.innerHTML = `
    <div style="font-size:.72rem;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${t('result.rpe.title')}</div>
    <div style="font-size:.68rem;color:var(--label);margin-bottom:10px;">${_getRpeSubtitle()}</div>
    <div style="text-align:center;">
      <div id="timer-rpe-display" style="font-size:2.2rem;font-weight:900;color:var(--label);line-height:1;">—</div>
      <div id="timer-rpe-label" style="font-size:.72rem;font-weight:700;color:var(--label);margin-top:2px;margin-bottom:10px;">${t('result.rpe.tap')}</div>
    </div>
    <input type="range" id="timer-rpe-slider" min="1" max="10" value="5" data-touched="false" style="width:100%;"
      oninput="_updateTimerRPEDisplay(this.value)">
    <div style="display:flex;justify-content:space-between;font-size:.62rem;color:var(--label);margin-top:2px;">
      <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
    </div>`;
  container.appendChild(rpeWrap);

  // Calculate Physics button
  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn-primary';
  goBtn.style.cssText = 'width:100%;margin-top:4px;';
  goBtn.textContent = '⚡ Calculate Physics';
  goBtn.onclick = () => {
    // Capture this section's RPE value/touched state BEFORE switching tabs —
    // switchTab(3) synchronously calls renderAnalyticsResults(), which
    // unconditionally REBUILDS all per-block RPE sliders with hardcoded defaults
    // (value=5, touched=false). Syncing before that rebuild was a real bug:
    // the sync would land, then get immediately clobbered by the rebuild,
    // so calculateGlobalPhysics() 300ms later always saw the reset
    // default — forcing the user to re-enter RPE they'd already set here.
    // Applying the captured value AFTER the rebuild (inside the timeout,
    // right before the physics calc reads it) fixes this properly.
    const timerRpeEl = document.getElementById('timer-rpe-slider');
    const capturedRpeValue = timerRpeEl?.value;
    const capturedRpeTouched = timerRpeEl?.dataset.touched;
    switchTab(3);
    setTimeout(() => {
      // Seed every block's RPE slider with the timer's single quick
      // rating — this is a starting point, not a per-block replacement;
      // never overwrites a block already individually touched (e.g. if
      // renderAnalyticsResults() restored a previously-set per-block
      // value). Only update the visible display for blocks it actually
      // seeds — a block already showing its own value should keep it.
      if (capturedRpeValue !== undefined && capturedRpeTouched === 'true') {
        document.querySelectorAll('[id^="result-rpe-slider-"]').forEach(el => {
          if (el.dataset.touched !== 'true') {
            el.value = capturedRpeValue;
            el.dataset.touched = 'true';
            const idx = el.id.replace('result-rpe-slider-', '');
            _updateInlineRPEDisplay(capturedRpeValue, idx);
          }
        });
      }
      calculateGlobalPhysics();
      // Scroll to the actual physics result cards, not just the general
      // Analytics tab — calculateGlobalPhysics() reveals the #results
      // section (removes its hidden-el class) synchronously, but a short
      // delay lets the browser finish that layout change before scrolling,
      // same defensive pattern as the outer 300ms delay above.
      setTimeout(() => {
        const resultsEl = document.getElementById('results');
        // Only scroll here if calculateGlobalPhysics() actually succeeded
        // (revealed the section) — if it hit its own gate for some other
        // reason and returned early, #results stays hidden and that gate's
        // own scroll-to-error behavior should be the only one that fires.
        if (resultsEl && !resultsEl.classList.contains('hidden-el')) {
          resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }, 300);
  };
  container.appendChild(goBtn);
}

function _updateTimerRPEDisplay(val) {
  val = parseInt(val);
  const slider = document.getElementById('timer-rpe-slider');
  const disp  = document.getElementById('timer-rpe-display');
  const label = document.getElementById('timer-rpe-label');
  const color = RPE_COLORS[val] || '#9CA3AF';
  if (slider) slider.dataset.touched = 'true';
  if (disp)  { disp.innerText = val; disp.style.color = color; }
  if (label) { label.innerText = RPE_LABELS[val] || ''; label.style.color = color; }
}

function renderAnalyticsResults() {
  const container = document.getElementById('analytics-results-section');
  if (!container) return;
  const blocks = document.querySelectorAll('.wod-block');
  if (!blocks.length) { container.innerHTML = ''; return; }

  // Save current rest value before wiping container
  const existingRestCard = container.querySelector('.res-rest-card');
  if (existingRestCard) {
    const v = parseInt(existingRestCard.querySelector('.res-rest')?.value);
    if (!isNaN(v)) window._savedAnalyticsRestSec = v;
  }

  // Save current per-block RPE values/touched-states before wiping
  // container — this function rebuilds all RPE sliders with hardcoded
  // defaults every time it runs, and it runs on every switch to the
  // Analytics tab, not just once — without this, any already-entered RPE
  // was silently lost on ordinary tab navigation, not just the
  // Timer-specific path this was first caught on.
  const existingRpeEls = container.querySelectorAll('[id^="result-rpe-slider-"]');
  if (existingRpeEls.length) {
    window._savedAnalyticsRpe = {};
    existingRpeEls.forEach(el => {
      const idx = el.id.replace('result-rpe-slider-', '');
      window._savedAnalyticsRpe[idx] = { value: el.value, touched: el.dataset.touched };
    });
  }

  // Preserve open state across re-renders
  const wasOpen = document.getElementById('analytics_results_acc')?.classList.contains('open');

  container.innerHTML = '';
  const section = document.createElement('div');
  section.className = 'accordion-section results-accordion' + (wasOpen ? ' open' : '');
  section.style.marginBottom = '14px';
  section.id = 'analytics_results_acc';
  section.innerHTML = `
    <div class="accordion-header" onclick="this.closest('.accordion-section').classList.toggle('open')">
      <div class="accordion-header-left">
        <span class="acc-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></span>
        <span class="acc-label">${t('acc.results.sim')}</span>
      </div>
      <span class="accordion-chevron">▼</span>
    </div>
    <div class="accordion-body" id="analytics_results_body"></div>`;
  container.appendChild(section);

  const body = section.querySelector('#analytics_results_body');
  const intro = document.createElement('p');
  intro.style.cssText = 'font-size:.72rem;color:var(--label);margin:0 0 12px;line-height:1.5;';
  intro.textContent = t('builder.enter.results');
  body.appendChild(intro);

  blocks.forEach((block, i) => {
    const mode = block.querySelector('.b-mode')?.value || 'fortime';
    const isTabata  = mode === 'tabata';
    const isForTime = mode === 'fortime';
    const modeLabel = { fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata', exmom:'EXMOM' }[mode] || mode;
    const hasEmom = block.querySelector('.emom-accordion')?.classList.contains('penalty-on');

    const blockWrap = document.createElement('div');
    blockWrap.style.cssText = 'margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);';

    // ── Workout Summary ──
    const modColor = { fortime:'#FF6B35', amrap:'#3B82F6', emom:'#22C55E', tabata:'#F59E0B', exmom:'#F59E0B' }[mode] || '#FF6B35';
    const bCap     = block.querySelector('.b-cap')?.value;
    const bDur     = block.querySelector('.b-dur')?.value;
    const bIntLen  = block.querySelector('.b-int')?.value;
    const bTotalInt= block.querySelector('.b-total-int')?.value;
    const bTabR    = block.querySelector('.b-tab-r')?.value;
    const bTarget  = block.querySelector('.b-target')?.value;
    let configStr = '';
    if (mode === 'fortime') configStr = `${bCap ? bCap + 'm ' + t('mode.cap') : t('mode.no.cap')}${bTarget && bTarget > 0 ? ' / ' + bTarget + ' ' + t('mode.rounds.short') : ''}`;
    else if (mode === 'amrap')  configStr = `${bDur}m AMRAP`;
    else if (mode === 'emom')   configStr = `${bTotalInt} ${t('mode.intervals')} × ${bIntLen}s`;
    else if (mode === 'tabata') configStr = `${bTabR} Rounds Tabata`;
    else if (mode === 'exmom') {
      const n = block.querySelectorAll('.movement-block').length || 'X';
      configStr = `E${n}MOM · ${bTotalInt} ${t('mode.intervals')} × ${bIntLen}s`;
    }

    const movements = [...block.querySelectorAll('.movement-block')];
    let mvLines;
    if (mode === 'exmom') {
      mvLines = movements.map((mv, si) => {
        const key  = mv.querySelector('input[type="hidden"]')?.value || '';
        const reps = mv.querySelector('.m-reps')?.value || '0';
        const kg   = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
        const kgStr = kg === 0 ? 'BW' : kg === 999 ? 'Max kg' : kg + 'kg';
        return `<div style="font-size:.73rem;color:var(--label);padding:2px 0;border-bottom:1px solid var(--border);">
          <span style="color:#F59E0B;font-weight:800;">${t('exmom.station')} ${si+1}:</span> ${reps} ${key} @ ${kgStr}
        </div>`;
      }).join('');
    } else {
      mvLines = buildRoundByRound(block, { dark: false });
    }

    blockWrap.innerHTML = `
      <div style="background:${modColor}0f;border:1px solid ${modColor}33;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${movements.length ? '8' : '0'}px;">
          <span style="font-size:.63rem;font-weight:800;color:${modColor};background:${modColor}22;border:1px solid ${modColor}44;border-radius:4px;padding:2px 7px;letter-spacing:.06em;">${modeLabel.toUpperCase()}</span>
          <span style="font-size:.72rem;font-weight:700;color:var(--label);">${configStr}</span>
          ${blocks.length > 1 ? `<span style="font-size:.68rem;color:var(--label);margin-left:auto;">Block ${i+1}</span>` : ''}
        </div>
        ${mvLines}
      </div>`;

    // Clone result fields from hidden block
    const resBlock = block.querySelector('.results-section');
    if (resBlock) {
      const cloned = resBlock.cloneNode(true);
      cloned.style.display = '';
      // Sync live values
      ['res-r','res-x','res-m','res-s','res-emom'].forEach(cls => {
        const liveInp  = block.querySelector('.' + cls);
        const cloneInp = cloned.querySelector('.' + cls);
        if (liveInp && cloneInp) {
          cloneInp.value = liveInp.value;
          const trig = cloneInp.closest('.picker-trigger');
          if (trig) trig.querySelector('.picker-trigger-val').textContent =
            formatPickerVal(parseFloat(liveInp.value)||0, trig.dataset.label);
        }
      });
      // Show/hide fields per modality
      cloned.querySelector('.res-time-wrap')?.classList.remove('hidden-el');
      cloned.querySelector('.res-wrap-r')?.classList.toggle('hidden-el', isTabata);
      if (!hasEmom) cloned.querySelector('.res-emom-wrap')?.classList.add('hidden-el');
      const xl = cloned.querySelector('.x-label');
      if (xl) xl.innerText = isTabata ? t('builder.total.reps') : t('builder.extra.reps');
      const rlClone2 = cloned.querySelector('.res-wrap-r label');
      if (rlClone2) rlClone2.innerText = (mode === 'emom' || mode === 'exmom') ? t('result.intervals.done') : t('result.rounds.done');
      // Re-wire picker triggers
      cloned.querySelectorAll('.picker-trigger').forEach(t => {
        const cls2 = t.querySelector('input[type="number"]')?.className?.split(' ')[0];
        if (!cls2) return;
        t.onclick = function() {
          const origInp = block.querySelector('.' + cls2);
          if (origInp) this.querySelector('input[type="number"]').value = origInp.value;
          openPickerWithCallback(this, (val) => {
            const origInp2 = block.querySelector('.' + cls2);
            if (origInp2) {
              origInp2.value = val;
              // If this is a result time field, mark as user-set to prevent auto-overwrite
              if (cls2 === 'res-m' || cls2 === 'res-s') {
                const rm = block.querySelector('.res-m');
                const rs = block.querySelector('.res-s');
                if (rm) rm.dataset.userSet = '1';
                if (rs) rs.dataset.userSet = '1';
                origInp2.dispatchEvent(new Event('input', {bubbles:true}));
              } else {
                origInp2.dispatchEvent(new Event('input', {bubbles:true}));
              }
            }
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, this.dataset.label);
          });
        };
      });
      blockWrap.appendChild(cloned);
    }

    // Max-weight per movement — any movement with kg=999
    {
      const maxWtMoves = [...block.querySelectorAll('.movement-block')].filter(mv =>
        parseFloat(mv.querySelector('.m-wt')?.value) === 999
      );
      if (maxWtMoves.length > 0) {
        const mvWrap = document.createElement('div');
        mvWrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
        mvWrap.innerHTML = '<div style="font-size:.68rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Max Load — Enter Results</div><div style="font-size:.68rem;color:var(--label);margin-bottom:8px;font-style:italic;">Enter heaviest load achieved for the prescribed reps</div>';
        maxWtMoves.forEach((mv, idx2) => {
          const name   = mv.querySelector('.m-search')?.value || 'Movement';
          const wtInp  = mv.querySelector('.m-wt');
          const stored = parseFloat(wtInp?.dataset.maxKgEntered) || '';
          const row    = document.createElement('div');
          row.className = 'field-stack';
          const pickerId = 'mv-max-kg-a-' + i + '-' + idx2;
          row.innerHTML = `<label style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:.68rem;font-weight:800;color:var(--brand);padding:2px 8px;background:rgba(255,107,53,.12);border-radius:4px;">MAX KG</span>
            ${name}
          </label>
          ${makePicker(pickerId, stored||0, VALS.kg.filter(v => v !== 999), name + ' Max Load (kg)')}`;
          const trig = row.querySelector('.picker-trigger');
          if (trig) {
            trig.style.border = '1.5px solid var(--brand)';
            trig.style.borderRadius = 'var(--radius-sm)';
            (function(mvElement, wtInput) {
              trig.onclick = function() {
                const curVal = parseFloat(this.dataset.val) || 0;
                this.querySelector('input[type="number"]').value = curVal;
                openPickerWithCallback(this, (val) => {
                  this.dataset.val = val;
                  this.querySelector('.picker-trigger-val').textContent = val + ' kg';
                  if (wtInput) wtInput.dataset.maxKgEntered = val;
                  autoSave();
                  closePicker();
                });
              };
            })(mv, wtInp);
          }
          mvWrap.appendChild(row);
        });
        blockWrap.appendChild(mvWrap);
      }
    }

    // Max-reps per movement — any movement with reps=999
    {
      const maxMoves = [...block.querySelectorAll('.movement-block')].filter(mv =>
        parseFloat(mv.querySelector('.m-reps')?.value) === 999
      );
      if (maxMoves.length > 0) {
        const mvWrap = document.createElement('div');
        mvWrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
        mvWrap.innerHTML = `<div style="font-size:.68rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${t('result.max.reps.title')}</div><div style="font-size:.68rem;color:var(--label);margin-bottom:8px;font-style:italic;">${t('result.max.reps.desc')}</div>`;
        maxMoves.forEach((mv, idx2) => {
          const name = mv.querySelector('.m-search')?.value || 'Movement';
          const stored = parseFloat(mv.querySelector('.m-reps')?.dataset.maxRepsEntered) || '';
          const row = document.createElement('div');
          row.className = 'field-stack';
          const pickerId2 = 'mv-max-am-' + i + '-' + idx2;
          row.innerHTML = `<label style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:.68rem;font-weight:800;color:var(--brand);padding:2px 8px;background:rgba(255,107,53,.12);border-radius:4px;">MAX</span>
            ${name}
          </label>
          ${makePicker(pickerId2, stored||0, VALS.reps, name + ' Max Reps')}`;
          const trig2 = row.querySelector('.picker-trigger');
          if (trig2) {
            trig2.style.border = '1.5px solid var(--brand)';
            trig2.style.borderRadius = 'var(--radius-sm)';
            (function(mvElement) {
              trig2.onclick = function() {
                const curVal = parseInt(this.dataset.val)||0;
                this.querySelector('input[type="number"]').value = curVal;
                openPickerWithCallback(this, (val) => {
                  this.dataset.val = val;
                  this.querySelector('.picker-trigger-val').textContent = val === 999 ? t('builder.max.reps') : val + ' reps';
                  if (mvElement?.querySelector('.m-reps')) mvElement.querySelector('.m-reps').dataset.maxRepsEntered = val;
                  autoSave();
                });
              };
            })(mv);
          }
          mvWrap.appendChild(row);
        });
        blockWrap.appendChild(mvWrap);
      }
    }

    // Per-block RPE — Phase 1 of the per-block RPE/HR redesign. Each
    // block gets its own perceived-effort rating instead of one shared,
    // session-wide value. The overhead calculation still averages these
    // (duration-weighted) into a single session-wide number for now —
    // see calculateGlobalPhysics()'s getBlockWeightedRPE() — real
    // per-block overhead attribution is Phase 2, pending the mechKcal/
    // cardioKcal split needed to compute it correctly per block.
    const rpeWrapBlock = document.createElement('div');
    rpeWrapBlock.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
    rpeWrapBlock.innerHTML = `
      <div style="font-size:.68rem;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${t('result.rpe.title')}</div>
      <div style="text-align:center;">
        <div id="result-rpe-display-${i}" style="font-size:1.7rem;font-weight:900;color:var(--label);line-height:1;">—</div>
        <div id="result-rpe-label-${i}" style="font-size:.68rem;font-weight:700;color:var(--label);margin-top:2px;margin-bottom:8px;">${t('result.rpe.tap')}</div>
      </div>
      <input type="range" id="result-rpe-slider-${i}" min="1" max="10" value="5" data-touched="false" style="width:100%;"
        oninput="_updateInlineRPEDisplay(this.value, ${i})">
      <div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--label);margin-top:2px;">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
      </div>`;
    blockWrap.appendChild(rpeWrapBlock);
    body.appendChild(blockWrap);

    // Restore this block's RPE value/touched-state captured before this
    // rebuild wiped it — see the capture near the top of this function.
    // MUST run after body.appendChild(blockWrap) above: document.getElementById
    // only finds elements actually attached to the live document, and
    // blockWrap (with the RPE slider inside it) was still a detached node
    // until that append — the lookup was silently finding nothing and
    // restore was a no-op every render, which is why per-block RPE never
    // survived a tab switch.
    if (window._savedAnalyticsRpe && window._savedAnalyticsRpe[i]) {
      const freshRpeEl = document.getElementById('result-rpe-slider-' + i);
      if (freshRpeEl) {
        const saved = window._savedAnalyticsRpe[i];
        freshRpeEl.value = saved.value;
        freshRpeEl.dataset.touched = saved.touched;
        if (saved.touched === 'true') _updateInlineRPEDisplay(saved.value, i);
      }
    }

    // Auto-populate result time from config if not yet entered
    autoPopulateResultTime(block);
  });

  // Build rest card outside accordion (always visible when 2+ blocks)
  buildRestCard(container, [...blocks]);
}

function _updateInlineRPEDisplay(val, idx) {
  val = parseInt(val);
  const slider = document.getElementById('result-rpe-slider-' + idx);
  const disp  = document.getElementById('result-rpe-display-' + idx);
  const label = document.getElementById('result-rpe-label-' + idx);
  const color = RPE_COLORS[val] || '#9CA3AF';
  if (slider) slider.dataset.touched = 'true';
  if (disp)  { disp.innerText = val; disp.style.color = color; }
  if (label) { label.innerText = RPE_LABELS[val] || ''; label.style.color = color; }
}

function buildRestCard(container, blocks) {
  if (blocks.length < 2) return;
  const old = container.querySelector('.res-rest-card');
  if (old) old.remove();

  const timerRan = window._timerRestCompleted && window._actualRestUsed > 0;
  const savedVal = window._savedAnalyticsRestSec;
  const builderVal = parseInt(document.getElementById('rest-duration-sec')?.value) || 0;
  const restSec = timerRan ? window._actualRestUsed
    : (savedVal !== undefined && savedVal !== null) ? savedVal : builderVal;

  const fmtSec = s => s >= 60 ? `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` : `${s}s`;
  const REST_OPTS = [
    { val: '0',   label: t('timer.no.rest.label') },
    { val: '5',   label: '5 sec' },  { val: '10',  label: '10 sec' },
    { val: '15',  label: '15 sec' }, { val: '20',  label: '20 sec' },
    { val: '25',  label: '25 sec' }, { val: '30',  label: '30 sec' },
    { val: '35',  label: '35 sec' }, { val: '40',  label: '40 sec' },
    { val: '45',  label: '45 sec' }, { val: '50',  label: '50 sec' },
    { val: '55',  label: '55 sec' }, { val: '60',  label: '1 min' },
    { val: '75',  label: '1:15 min' }, { val: '90',  label: '1:30 min' },
    { val: '105', label: '1:45 min' }, { val: '120', label: '2 min' },
    { val: '150', label: '2:30 min' }, { val: '180', label: '3 min' },
    { val: '210', label: '3:30 min' }, { val: '240', label: '4 min' },
    { val: '270', label: '4:30 min' }, { val: '300', label: '5 min' },
    { val: '360', label: '6 min' },  { val: '420', label: '7 min' },
    { val: '480', label: '8 min' },  { val: '540', label: '9 min' },
    { val: '600', label: '10 min' },
  ];

  const curLabel = restSec > 0
    ? (REST_OPTS.find(o => parseInt(o.val) === restSec)?.label || fmtSec(restSec))
    : t('timer.no.rest.label');

  const card = document.createElement('div');
  card.className = 'res-rest-card card';
  card.style.cssText = 'padding:12px 14px;margin-bottom:14px;border:1.5px solid var(--accent);';
  card.innerHTML = `
    <div style="font-size:.72rem;font-weight:900;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">⏸️ ${t('res.total.rest')}</div>
    <div style="font-size:.72rem;color:var(--label);margin-bottom:10px;line-height:1.5;">${timerRan ? t('res.rest.actual') : t('res.rest.prefill')}</div>
    <div class="field-stack">
      <label>${t('box.rest.duration')}</label>
      <div class="picker-trigger" id="res-rest-trigger" data-label="${t('box.rest.duration')}" style="min-width:110px;">
        <span class="picker-trigger-val" id="res-rest-val">${curLabel}</span>
        <span class="picker-trigger-chevron">▼</span>
        <input type="number" class="res-rest" value="${restSec}" style="display:none;">
      </div>
    </div>`;

  const trigger = card.querySelector('#res-rest-trigger');
  if (trigger) {
    trigger.onclick = function() {
      const overlay = document.getElementById('pickerOverlay');
      const drum    = document.getElementById('pickerDrum');
      const label   = document.getElementById('pickerLabel');
      label.textContent = t('box.rest.duration');
      overlay._profField = null;
      overlay._restPicker = false;
      overlay._customCallback = (val) => {
        const found = REST_OPTS.find(o => o.val === String(val));
        const displayEl = document.getElementById('res-rest-val');
        if (displayEl) displayEl.textContent = found ? found.label : fmtSec(parseInt(val));
        const inp = card.querySelector('.res-rest');
        if (inp) inp.value = val;
        window._savedAnalyticsRestSec = parseInt(val);
      };
      buildOptDrum(drum, REST_OPTS, String(restSec), 'res-rest-custom');
      overlay.classList.add('open');
    };
  }

  container.insertBefore(card, container.firstChild);
}

/* ── Movement drag-to-reorder ── */
function attachMovementListDrag(list, blockId) {
  let dragSrc = null;
  let placeholder = null;

  list.querySelectorAll('.movement-row').forEach(row => {
    const handle = row.querySelector('.mv-drag-handle');
    if (!handle) return;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.style.touchAction = 'none'; // disable scroll only during drag

      dragSrc = row;
      const srcHeight = row.offsetHeight;

      // Create placeholder
      placeholder = document.createElement('div');
      placeholder.style.cssText = `height:${srcHeight}px;background:var(--surface2);border:2px dashed var(--brand);border-radius:var(--radius-sm);margin-bottom:8px;opacity:.6;`;
      list.insertBefore(placeholder, row.nextSibling);

      // Float the row
      const rect = row.getBoundingClientRect();
      row.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;z-index:9999;margin:0;box-shadow:0 8px 24px rgba(0,0,0,.3);`;
      row.classList.add('dragging');

      let startY = e.clientY;
      let currentY = rect.top;

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);

      function onMove(ev) {
        const dy = ev.clientY - startY;
        currentY = rect.top + dy;
        row.style.top = currentY + 'px';

        // Find insertion point
        const siblings = [...list.querySelectorAll('.movement-row:not(.dragging)')];
        let insertBefore = null;
        for (const sib of siblings) {
          const sibRect = sib.getBoundingClientRect();
          if (ev.clientY < sibRect.top + sibRect.height / 2) {
            insertBefore = sib;
            break;
          }
        }
        if (insertBefore) {
          list.insertBefore(placeholder, insertBefore);
        } else {
          list.appendChild(placeholder);
        }
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        handle.style.touchAction = ''; // restore scroll

        if (!dragSrc) return;

        // Restore row style
        row.style.cssText = '';
        row.classList.remove('dragging');

        // Insert row where placeholder is
        list.insertBefore(row, placeholder);
        placeholder.remove();
        placeholder = null;

        // Sync hidden .movement-block order to match new visual order
        const block = document.getElementById(blockId);
        if (block) {
          const mList = block.querySelector('.m-list');
          const visRows = [...list.querySelectorAll('.movement-row')];
          const mbNodes = [...mList.querySelectorAll('.movement-block')];
          // Build new order based on data-mv-idx
          const newOrder = visRows.map(r => {
            const idx = parseInt(r.dataset.mvIdx);
            return mbNodes[idx];
          }).filter(Boolean);
          // Re-append in new order
          newOrder.forEach(n => mList.appendChild(n));
          renderMovementPanel(blockId);
          updateBlueprint();
          autoSave();
        }
        dragSrc = null;
      }
    });
  });
}

/* ── Block list renderer ── */
function renderBlockList() {
  const blocks = document.querySelectorAll('.wod-block');
  const list = document.getElementById('block-list');
  if (!list) return;
  // Show FAB only when builder tab is active and template panel is not open
  const fab = document.querySelector('.builder-fab');
  const templateOpen = document.getElementById('template-panel')?.classList.contains('open');
  if (fab) fab.style.display = (currentTab === 1 && !_openBlockId && !_openMovBlockId && !templateOpen) ? 'flex' : 'none';
  if (!blocks.length) {
    const restSection = document.getElementById('rest-between-blocks-section');
    if (restSection) restSection.style.display = 'none';
    list.innerHTML = `<div style="text-align:center;padding:40px 20px 30px;">
      <div style="margin-bottom:16px;opacity:.9;"><svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Back card -->
  <rect x="15" y="62" width="90" height="26" rx="7" stroke="var(--brand)" stroke-width="1.5" opacity=".2"/>
  <!-- Mid card -->
  <rect x="10" y="50" width="90" height="26" rx="7" stroke="var(--brand)" stroke-width="1.5" opacity=".45"/>
  <!-- Front card -->
  <rect x="5" y="38" width="90" height="26" rx="7" stroke="var(--brand)" stroke-width="2"/>
  <!-- + badge floating above stack -->
  <circle cx="60" cy="18" r="15" fill="var(--brand)" opacity=".12"/>
  <circle cx="60" cy="18" r="15" stroke="var(--brand)" stroke-width="1.5" opacity=".5"/>
  <line x1="60" y1="10" x2="60" y2="26" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="52" y1="18" x2="68" y2="18" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"/>
</svg></div>
      <div style="font-size:.9rem;font-weight:800;color:var(--text);margin-bottom:6px;">${t('empty.builder')}</div>
      <div style="font-size:.74rem;color:var(--label);line-height:1.6;max-width:240px;margin:0 auto;">${t('empty.builder.sub')}</div>
    </div>`;
    return;
  }
  list.innerHTML = '';
  // Show rest accordion only when 2+ blocks
  const restSection = document.getElementById('rest-between-blocks-section');
  if (restSection) restSection.style.display = blocks.length >= 2 ? '' : 'none';

  renderAnalyticsResults();

  blocks.forEach((b, i) => {
    const mode = b.querySelector('.b-mode').value.toUpperCase();
    const id = b.id;
    let sub = getModeLabel(b, mode);
    const cwodOpen = b.querySelector('.classic-accordion.open');
    const wodName = cwodOpen ? b.querySelector('.cwod-select')?.value : '';
    if (wodName) sub = '★ ' + wodName + ' · ' + sub;
    const moveCount = b.querySelectorAll('.movement-block, .movement-row-data').length;
    if (moveCount) sub += ` · ${moveCount} movement${moveCount !== 1 ? 's' : ''}`;

    const btn = document.createElement('button');
    btn.className = 'block-btn';  // no persistent highlight — only timer highlights active block
    btn.setAttribute('data-id', id);
    btn.dataset.blockId = id;
    btn.innerHTML = `
      <div class="block-drag-handle" onclick="event.stopPropagation()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="3" y1="4" x2="13" y2="4"/>
          <line x1="3" y1="8" x2="13" y2="8"/>
          <line x1="3" y1="12" x2="13" y2="12"/>
        </svg>
      </div>
      <div class="block-btn-num">${i+1}</div>
      <div class="block-btn-info">
        <div class="block-btn-title">${mode}</div>
        <div class="block-btn-sub">${sub}</div>
      </div>
      <span class="block-btn-arrow">›</span>`;
    btn.onclick = () => openBlockDetail(id);
    list.appendChild(btn);
  });

  attachBlockListDrag(list);
}

function getModeLabel(b, mode) {
  if (mode === 'FORTIME') return `${b.querySelector('.b-cap')?.value||'?'} ${t('mode.cap')} / ${b.querySelector('.b-target')?.value||'?'} ${t('mode.rounds.short')}`;
  if (mode === 'AMRAP')   return `${b.querySelector('.b-dur')?.value||'?'} min AMRAP`;
  if (mode === 'EMOM')    return `${b.querySelector('.b-total-int')?.value||'?'} ${t('mode.intervals')} × ${b.querySelector('.b-int')?.value||'?'}s`;
  if (mode === 'TABATA')  return `${b.querySelector('.b-tab-r')?.value||'?'} ${t('mode.rounds.short')} Tabata`;
  if (mode === 'EXMOM')   {
    const n = b.querySelectorAll('.movement-block').length;
    return `E${n||'X'}MOM · ${b.querySelector('.b-total-int')?.value||'?'} × ${b.querySelector('.b-int')?.value||'?'}s`;
  }
  return mode;
}

/* ── Block drag-to-reorder ── */
function attachBlockListDrag(list) {
  let dragSrc = null;
  let floatClone = null;
  let placeholder = null;

  list.querySelectorAll('.block-btn').forEach(btn => {
    const handle = btn.querySelector('.block-drag-handle');
    if (!handle) return;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      dragSrc = btn;
      const srcHeight = btn.offsetHeight;
      const rect = btn.getBoundingClientRect();

      // Placeholder stays in list
      placeholder = document.createElement('div');
      placeholder.style.cssText = `height:${srcHeight}px;background:var(--surface2);border:2px dashed var(--brand);border-radius:var(--radius-sm);margin-bottom:8px;opacity:.6;box-sizing:border-box;`;
      list.insertBefore(placeholder, btn.nextSibling);

      // Float clone appended to body to escape transform clipping
      floatClone = btn.cloneNode(true);
      floatClone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;z-index:9999;margin:0;opacity:.7;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.4);border-radius:var(--radius-sm);`;
      document.body.appendChild(floatClone);

      // Hide original in list
      btn.style.visibility = 'hidden';

      let startY = e.clientY;

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);

      function onMove(ev) {
        const dy = ev.clientY - startY;
        floatClone.style.top = (rect.top + dy) + 'px';

        const siblings = [...list.querySelectorAll('.block-btn')].filter(b => b !== btn);
        let insertBefore = null;
        for (const sib of siblings) {
          const sibRect = sib.getBoundingClientRect();
          if (ev.clientY < sibRect.top + sibRect.height / 2) {
            insertBefore = sib;
            break;
          }
        }
        if (insertBefore) list.insertBefore(placeholder, insertBefore);
        else list.appendChild(placeholder);
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        // Remove clone
        if (floatClone) { floatClone.remove(); floatClone = null; }

        // Restore and reinsert original
        btn.style.visibility = '';
        list.insertBefore(btn, placeholder);
        if (placeholder) { placeholder.remove(); placeholder = null; }

        // Reorder .wod-block elements in #timeline
        const timeline = document.getElementById('timeline');
        const newOrder = [...list.querySelectorAll('.block-btn')].map(b => b.dataset.blockId);
        newOrder.forEach(id => {
          const block = document.getElementById(id);
          if (block) timeline.appendChild(block);
        });

        renderBlockList();
        updateBlueprint();
        autoSave();
        dragSrc = null;
      }
    });
  });
}

/* ── Open block detail panel ── */
function openBlockDetail(id) {
  if (window._activeBoxSession) { showToast(t('toast.locked')); return; }
  const block = document.getElementById(id);
  if (!block) return;
  _openBlockId = id;
  const idx = [...document.querySelectorAll('.wod-block')].indexOf(block);
  document.getElementById('block-detail-title').innerText = `${t('builder.block.n')} ${idx + 1}`;
  renderDetailBody(id);
  const panel = document.getElementById('block-detail-panel');
  panel.scrollTop = 0;
  panel.classList.add('open');
  // Scroll the builder screen to top so panel inset:0 starts at top
  const screen = document.getElementById('screen-builder');
  if (screen) screen.scrollTop = 0;
  // Hide builder FAB while inside a block
  const fab = document.querySelector('.builder-fab');
  if (fab) fab.style.display = 'none';
}

function closeBlockDetail() {
  document.getElementById('block-detail-panel').classList.remove('open');
  _openBlockId = null;
  // Close movement panel too
  document.getElementById('movement-panel')?.classList.remove('open');
  document.getElementById('movement-fab')?.classList.remove('visible');
  renderBlockList();   // re-shows builder FAB via currentTab check
  updateBlueprint();
}

/* ── Render detail body from block's hidden data ── */
function renderDetailBody(id) {
  const block = document.getElementById(id);
  if (!block) return;
  const body = document.getElementById('block-detail-body');
  body.innerHTML = '';

  // Order: 1-Classic WOD, 2-Modality, 3-Movements, 4-EMOM Interruptor
  const emomAcc = block.querySelector('.emom-accordion');
  const cwodAcc = block.querySelector('.classic-accordion');

  // 1. Classic WOD accordion
  if (cwodAcc) {
    const cwodClone = cwodAcc.cloneNode(true);
    const liveSel  = block.querySelector('.cwod-select');
    const cloneSel = cwodClone.querySelector('.cwod-select');
    if (liveSel && cloneSel) cloneSel.value = liveSel.value;
    const liveDesc  = block.querySelector('[id^="cwod_desc_"]');
    const cloneDesc = cwodClone.querySelector('[id^="cwod_desc_"]');
    if (liveDesc && cloneDesc) cloneDesc.innerHTML = liveDesc.innerHTML;
    if (cloneSel) {
      cloneSel.removeAttribute('onchange');  // remove any HTML attribute that survived cloneNode
      cloneSel.onchange = function() {
        const origSel = block.querySelector('.cwod-select');
        if (origSel) origSel.value = this.value;
        applyClassicWOD(id, this.value);
      };
    }
    // Re-wire accordion header
    const cwodHeader = cwodClone.querySelector('.accordion-header');
    if (cwodHeader) {
      cwodHeader.onclick = () => {
        const origSection = block.querySelector('.classic-accordion');
        if (!origSection) return;
        const isOpen = origSection.classList.toggle('open');
        cwodClone.classList.toggle('open', isOpen);
        updateBlueprint(); renderBlockOverview(id);
      };
    }
    body.appendChild(cwodClone);
  }

  // Re-wire cloned search inputs (cwod search if any)
  body.querySelectorAll('.m-search').forEach(inp => {
    inp.oninput = () => handleSearch(inp);
    inp.onfocus = () => wireSearchFocus(inp);
  });

  // EMOM clone will be appended after Movements — store ref for sync below
  // (sync happens after append at end of function)
  let cloneEmomAcc = null, cloneEmomBody = null;
  if (cloneEmomAcc) {
    const penaltyOn = block.querySelector('.emom-accordion')?.classList.contains('penalty-on');
    cloneEmomAcc.classList.toggle('penalty-on', penaltyOn);
    const cloneChk = cloneEmomAcc.querySelector('.emom-enabled');
    if (cloneChk) cloneChk.checked = penaltyOn;
    // Sync all EMOM picker displays from the hidden block's live .value properties
    // (cloneNode copies HTML attributes, not live .value properties)
    if (cloneEmomBody) {
      [['int-reps','Reps'],['int-wt','Weight (kg)'],['int-sec','Every (seconds)']].forEach(([cls, label]) => {
        const liveInp  = block.querySelector('.' + cls);
        const cloneTrig = cloneEmomBody.querySelector(`.picker-trigger[data-label="${label}"]`);
        if (!liveInp || !cloneTrig) return;
        const cloneInp = cloneTrig.querySelector('input[type="number"]');
        if (cloneInp) cloneInp.value = liveInp.value;
        cloneTrig.querySelector('.picker-trigger-val').textContent =
          formatPickerVal(parseFloat(liveInp.value)||0, label);
      });
      // Sync m-search display
      const liveSearch  = block.querySelector('.emom-accordion .m-search');
      const cloneSearch = cloneEmomBody.querySelector('.m-search');
      if (liveSearch && cloneSearch) cloneSearch.value = liveSearch.value;
      // Re-wire EMOM picker triggers to write back to hidden block
      [['int-reps','Reps'],['int-wt','Weight (kg)'],['int-sec','Every (seconds)']].forEach(([cls, label]) => {
        const cloneTrig = cloneEmomBody.querySelector(`.picker-trigger[data-label="${label}"]`);
        if (!cloneTrig) return;
        cloneTrig.onclick = function() {
          const origInp = block.querySelector('.' + cls);
          if (origInp) {
            const curInp = this.querySelector('input[type="number"]');
            if (curInp) curInp.value = origInp.value; // sync before opening
          }
          openPickerWithCallback(this, (val) => {
            const origInp = block.querySelector('.' + cls);
            if (origInp) {
              origInp.value = val;
              origInp.dispatchEvent(new Event('input', {bubbles:true}));
            }
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, label);
            updateBlueprint();
            renderBlockOverview(id);
          });
        };
      });
      // Apply BW lock
      const origIntKey = block.querySelector('.int-key')?.value || '';
      const isBWKey    = !!(origIntKey && MASTER_DB[origIntKey]?.type === 'bw');
      const cloneWtTrig = cloneEmomBody.querySelector('.picker-trigger[data-label="Weight (kg)"]');
      if (cloneWtTrig) setPickerDisabled(cloneWtTrig, isBWKey);
    }
  }

  // --- Modality accordion ---
  const modeAcc = document.createElement('div');
  modeAcc.className = 'accordion-section modality-accordion';
  modeAcc.id = 'modality_acc_' + id;
  const currentMode = block.querySelector('.b-mode').value;
  const modeLabels = { fortime: t('mode.fortime'), amrap: t('mode.amrap'), emom: t('mode.emom'), tabata: t('mode.tabata'), exmom: t('mode.exmom') };
  const modeIcons  = { fortime: '⏱', amrap: '🔄', emom: '⚡', tabata: '🔥', exmom: '🔀' };
  modeAcc.innerHTML = `
    <div class="accordion-header modality-accordion-header" onclick="toggleModalityAcc('${id}')">
      <div class="accordion-header-left">
        <span class="acc-icon" id="modality_icon_${id}">${modeIcons[currentMode]||'🏋️'}</span>
        <span class="acc-label">${t('block.modality')}: <strong id="modality_label_${id}">${modeLabels[currentMode]||currentMode}</strong></span>
      </div>
      <span class="accordion-chevron">▼</span>
    </div>
    <div class="accordion-body" id="modality_body_${id}"></div>`;
  body.appendChild(modeAcc);

  // Build the accordion body content
  const modeBody = modeAcc.querySelector('.accordion-body');
  // Mode selector
  const modeClone = block.querySelector('.b-mode').cloneNode(true);
  modeClone.value = block.querySelector('.b-mode').value;  // sync live value, cloneNode copies attributes not .value
  modeClone.style.marginBottom = '10px';
  modeClone.onchange = function() {
    block.querySelector('.b-mode').value = this.value;
    updateBlockUI(block.querySelector('.b-mode'));
    updateBlueprint();
    syncDetailSummary(id);
    // Update accordion header label + icon
    document.getElementById('modality_label_' + id).textContent = modeLabels[this.value] || this.value;
    document.getElementById('modality_icon_' + id).textContent = modeIcons[this.value] || '🏋️';
    // Re-render config fields
    renderDetailConfig(id, body, this.value);
  };
  modeBody.appendChild(modeClone);

  // Config panel (picker fields for cap, duration, intervals, etc.)
  const cfgWrap = document.createElement('div');
  cfgWrap.id = 'detail-cfg-' + id;
  modeBody.appendChild(cfgWrap);
  renderDetailConfig(id, body, currentMode);

  // --- 3. Movements button ---
  const movBtn = document.createElement('button');
  movBtn.className = 'block-btn';
  movBtn.style.marginTop = '12px';
  movBtn.id = 'mov-btn-' + id;
  const movCount = block.querySelectorAll('.movement-block').length;
  movBtn.innerHTML = `
    <div class="block-btn-num" style="background:var(--accent);">💪</div>
    <div class="block-btn-info">
      <div class="block-btn-title">${t('block.movements.btn')}</div>
      <div class="block-btn-sub" id="mov-btn-sub-${id}">${movCount ? movCount + ' ' + (movCount!==1 ? t('builder.movements') : t('builder.movement')) : t('builder.tap.movements')}</div>
    </div>
    <span class="block-btn-arrow">›</span>`;
  movBtn.onclick = () => openMovementPanel(id);
  body.appendChild(movBtn);

  // --- 4. EMOM Interruptor accordion (last) ---
  if (emomAcc) {
    const emomCloneEl = emomAcc.cloneNode(true);
    emomCloneEl.style.marginTop = '12px';
    const emomCloneHeader = emomCloneEl.querySelector('.accordion-header');
    if (emomCloneHeader) {
      emomCloneHeader.onclick = () => {
        const origSection = block.querySelector('.emom-accordion');
        if (!origSection) return;
        const isOpen = origSection.classList.toggle('open');
        emomCloneEl.classList.toggle('open', isOpen);
        updateBlueprint(); renderBlockOverview(id);
      };
    }
    // Re-wire EMOM toggle button
    const toggleWrap = emomCloneEl.querySelector('.emom-toggle-wrap');
    if (toggleWrap) {
      toggleWrap.onclick = function(e) {
        e.stopPropagation(); e.preventDefault();
        const chk = this.querySelector('.emom-enabled');
        chk.checked = !chk.checked;
        toggleEmomEnabled(id, chk.checked);
      };
    }
    body.appendChild(emomCloneEl);
    // Set refs for sync below
    cloneEmomAcc  = emomCloneEl;
    cloneEmomBody = emomCloneEl.querySelector('[id^="emom_body_"]');
  }

  // Results fields still in hidden block for timer/physics — now on Analytics screen

  // Reset buttons
  const resetRow = document.createElement('div');
  resetRow.className = 'block-reset-row';
  resetRow.style.marginTop = '14px';
  const btnClear = document.createElement('button');
  btnClear.className = 'block-reset-btn';
  btnClear.textContent = '🗑 ' + t('block.clear.movements');
  btnClear.onclick = () => resetBlockMovements(id);
  const btnReset = document.createElement('button');
  btnReset.className = 'block-reset-btn';
  btnReset.textContent = '↺ ' + t('block.reset');
  btnReset.onclick = () => resetBlockFull(id);
  resetRow.appendChild(btnClear);
  resetRow.appendChild(btnReset);
  body.appendChild(resetRow);

  // Block overview — compact summary of movements + modality
  const ovCard = document.createElement('div');
  ovCard.id = 'block-overview-' + id;
  ovCard.style.cssText = 'margin-top:16px;';
  body.appendChild(ovCard);
  renderBlockOverview(id);
}

/* Render modality config fields into detail panel */
function renderDetailConfig(id, body, mode) {
  const block = document.getElementById(id);
  let wrap = document.getElementById('detail-cfg-' + id);
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'detail-cfg-' + id; body.appendChild(wrap); }
  wrap.innerHTML = '';

  const cfgClone = block.querySelector('.b-cfg-container')?.cloneNode(true);
  if (!cfgClone) return;
  // Show only the right panel
  cfgClone.querySelectorAll('.b-cfg').forEach(p => {
    p.classList.toggle('hidden-el', !p.classList.contains('b-cfg-' + mode));
  });
  // Re-wire picker triggers
  cfgClone.querySelectorAll('.picker-trigger').forEach(t => {
    const inp = t.querySelector('input[type="number"]');
    const cls = inp?.className?.split(' ')[0];
    if (!cls) return;
    t.onclick = function() {
      openPickerWithCallback(this, (val) => {
        const origInp = block.querySelector('.' + cls);
        if (origInp) { origInp.value = val; origInp.dispatchEvent(new Event('input',{bubbles:true})); }
        this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, this.dataset.label);
        syncDetailSummary(id);
        // Update ladder preview and movements if this is a ladder field
        if (['b-ladder-start','b-ladder-inc','b-total-int','b-target'].includes(cls)) {
          updateLadderPreview(id);
          // Defer movement update so picker closes cleanly first
          setTimeout(() => {
            updateBlockMovementsForLadder(id);
          }, 50);
        }
      });
    };
    // Sync display value from original
    const origInp = block.querySelector('.' + cls);
    if (origInp) {
      inp.value = origInp.value;
      t.querySelector('.picker-trigger-val').textContent = formatPickerVal(parseFloat(origInp.value), t.dataset.label);
    }
  });
  wrap.appendChild(cfgClone);

  // Sync ladder state from block to detail panel
  const ladderType = block.querySelector('.b-ladder-type')?.value || 'fixed';
  cfgClone.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = ladderType);
  cfgClone.querySelectorAll('.ladder-type-btn').forEach(btn => {
    const active = btn.dataset.type === ladderType;
    btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
    btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
    btn.style.color       = active ? 'white'        : 'var(--text)';
  });
  cfgClone.querySelectorAll('.ladder-fields').forEach(f => {
    f.style.display = ladderType === 'fixed' ? 'none' : '';
  });
  updateLadderPreview(id);
}

/* Render movement rows into detail panel */
function renderDetailMovements(id) {
  const block = document.getElementById(id);
  const list = document.getElementById('detail-movlist-' + id);
  if (!list || !block) return;
  const mode = block.querySelector('.b-mode').value;
  const isT = mode === 'tabata';

  list.innerHTML = '';
  block.querySelectorAll('.movement-block').forEach((mb, idx) => {
    const name = mb.querySelector('.m-search').value || t('builder.movement.n') + ' ' + (idx+1);
    const reps = mb.querySelector('.m-reps')?.value || '0';
    const _rawKg = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
    const kg   = _rawKg === 999 ? (parseFloat(mb.querySelector('.m-wt')?.dataset?.maxKgEntered) || 0) : _rawKg;
    const kgLabel = kg == 0 ? 'BW' : kg + ' kg';
    const rmPctMov = (!isT && kg > 0) ? get1RMPercent(name, parseFloat(kg)) : null;
    const rmSuffix = rmPctMov !== null ? ` · ${rmPctMov}% ${get1RMRefLabel(name)}` : '';
    const cxMov = MASTER_DB[mb.querySelector('input[type="hidden"]')?.value]?.cx;
    const cxSuffix = cxMov ? ` · cx${cxMov}` : '';
    const _phNote2 = _rawKg > 0 && _rawKg !== 999 ? getPerHandNote(name, _rawKg) : '';
    const kgLabelPH2 = kgLabel + (_phNote2 ? ' (' + _phNote2 + ')' : '');
    const _repsDisplay2 = parseFloat(reps) === 999 ? t('builder.max.reps') : `×${reps}`;
    const sub  = isT ? kgLabelPH2 : `${_repsDisplay2} @ ${kgLabelPH2}${rmSuffix}${cxSuffix}`;

    const row = document.createElement('div');
    row.className = 'movement-row';
    row.dataset.mvIdx = idx;
    row.innerHTML = `
      <div class="movement-row-header" onclick="toggleMovementEditor(this.closest('.movement-row'))">
        <div class="mv-drag-handle" onclick="event.stopPropagation()">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="3" y1="4" x2="13" y2="4"/>
            <line x1="3" y1="8" x2="13" y2="8"/>
            <line x1="3" y1="12" x2="13" y2="12"/>
          </svg>
        </div>
        <div class="movement-row-icon">${idx+1}</div>
        <div style="flex:1;min-width:0;">
          <div class="movement-row-name">${name}</div>
          <span class="movement-row-sub">${sub}</span>
        </div>
        <button class="movement-row-del" onclick="event.stopPropagation();removeMovement('${id}',${idx})">✕</button>
        <span class="movement-row-chevron">▼</span>
      </div>
      <div class="movement-editor">
        <div class="movement-editor-inner"></div>
      </div>`;

    // Build editor content
    const editorInner = row.querySelector('.movement-editor-inner');
    // Search
    const sc = document.createElement('div');
    sc.className = 'search-container';
    sc.style.cssText = 'margin-bottom:10px;margin-top:12px;';
    sc.innerHTML = `<label data-i18n="block.exercise">Exercise</label>
      <div class="search-wrap">
        <input type="text" class="m-search" value="${mb.querySelector('.m-search').value}" placeholder="Search movement…" data-i18n-placeholder="search.movement" oninput="handleSearch(this)">
        <div class="search-results"></div>
      </div>
      <input type="hidden" value="${mb.querySelector('input[type=hidden]').value}">`;
    editorInner.appendChild(sc);

    // Reps picker (hidden for tabata)
    if (!isT) {
      const repWrap = document.createElement('div');
      repWrap.className = 'field-stack';
      const ladderSeq = getLadderSequence(block);
      const ladderDisplay = ladderSeq ? getLadderRepsDisplay(block, reps) : null;
      if (ladderDisplay) {
        // Ladder mode — show sequence, locked
        repWrap.innerHTML = `<label data-i18n="block.reps.round">${t('block.reps.round')}</label>
          <div class="picker-trigger" style="opacity:.6;pointer-events:none;cursor:default;">
            <span class="picker-trigger-val" style="color:var(--brand);font-weight:800;">${ladderDisplay}</span>
          </div>`;
      } else {
        repWrap.innerHTML = `<label data-i18n="block.reps.round">Reps / Round</label>` + makePicker('_det_reps_'+idx, parseInt(reps)||0, VALS.reps, 'Reps');
        const repTrigger = repWrap.querySelector('.picker-trigger');
        repTrigger.onclick = function() {
          openPickerWithCallback(this, (val) => {
            const origReps = mb.querySelector('.m-reps');
            if (origReps) { origReps.value = val; origReps.dispatchEvent(new Event('input',{bubbles:true})); }
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, t('builder.reps'));
            const curKg = mb.querySelector('.m-wt')?.value || '0';
            const curKgLabel = curKg == 0 ? 'BW' : curKg + ' kg';
            const _wtTypeU1 = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
            const _repSeqU1 = getLadderSequence(block);
            const _roundsU1 = _repSeqU1 ? _repSeqU1.length : (parseInt(block.querySelector('.b-target')?.value)||1);
            const _wtSeqU1 = _wtTypeU1 !== 'fixed' ? getWtLadderSequence(mb, _roundsU1) : null;
            const _kgLabelU1 = _wtTypeU1 !== 'fixed' ? (fmtWtScheme(mb, _roundsU1) || curKgLabel) : curKgLabel;
            row.querySelector('.movement-row-sub').textContent = `×${val} @ ${_kgLabelU1}`;
          });
        };
      }
      editorInner.appendChild(repWrap);
    }

    // Weight picker
    const wtDisabled = mb.querySelector('.m-wt')?.disabled;
    const kgWrap = document.createElement('div');
    kgWrap.className = 'field-stack';
    kgWrap.innerHTML = `<label>${t('block.weight.kg')}</label>` + makePicker('_det_kg_'+idx, parseFloat(kg)||0, VALS.kg, 'Weight (kg)', wtDisabled ? 'disabled' : '');
    const kgTrigger = kgWrap.querySelector('.picker-trigger');
    if (!wtDisabled) {
      kgTrigger.onclick = function() {
        openPickerWithCallback(this, (val) => {
          const origWt = mb.querySelector('.m-wt');
          if (origWt) { origWt.value = val; origWt.dispatchEvent(new Event('input',{bubbles:true})); }
          this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, t('builder.weight'));
          // Update sub-label in-place — do NOT re-render (would collapse the row)
          const curReps = mb.querySelector('.m-reps')?.value || '0';
          const kgLabel = val == 0 ? 'BW' : val + ' kg';
          const subText = isT ? kgLabel : `×${curReps} @ ${kgLabel}`;
          row.querySelector('.movement-row-sub').textContent = subText;
        });
      };
    }
    editorInner.appendChild(kgWrap);

    // Suggested weight
    if (!wtDisabled) {
      const suggDiv = document.createElement('div');
      suggDiv.innerHTML = makeSuggestionHTML(name);
      if (suggDiv.firstElementChild) editorInner.appendChild(suggDiv.firstElementChild);
    }

    // ── Rep scheme override — after weight scheme ──
    const ovDiv1 = _buildRepOverrideUI(mb, id, idx, block);
    if (ovDiv1) editorInner.appendChild(ovDiv1);

    // ── Controlled descent toggle — one-directional movements only ──
    const eccDiv = _buildEccentricToggleUI(mb, id, idx);
    if (eccDiv) { eccDiv.classList.add('ecc-toggle-wrap'); editorInner.appendChild(eccDiv); }

    list.appendChild(row);
  });
}

function _buildRepOverrideUI(mb, blockId, idx, block) {
  const isT = block?.querySelector('.b-mode')?.value === 'tabata';
  if (isT) return null;
  // Only show when block has a ladder rep scheme (not fixed)
  const blockLadderType = block?.querySelector('.b-ladder-type')?.value || 'fixed';
  const hasLadder = getLadderSequence(block) !== null || blockLadderType !== 'fixed';
  if (!hasLadder) return null;
  const mpRounds = getLadderSequence(block)?.length || (parseInt(block?.querySelector('.b-target')?.value)||1);
  const mpOverride = mb.querySelector('.m-reps-override')?.value === '1';
  const mpScheme   = mb.querySelector('.m-reps-scheme')?.value || 'fixed';
  const mpInc      = parseInt(mb.querySelector('.m-reps-inc')?.value) || 5;
  const mpStart    = parseInt(mb.querySelector('.m-reps')?.value) || 0;  // live start reps
  const schemeLabels = {
    fixed: t('ladder.wt.fixed'),
    ascending: '↑ ' + t('ladder.wt.asc').replace(/↑\s*/,''),
    descending: '↓ ' + t('ladder.wt.desc').replace(/↓\s*/,''),
    pyramid: '△ ' + t('ladder.wt.pyramid').replace(/△\s*/,''),
    valley: '▽ ' + t('ladder.wt.valley').replace(/▽\s*/,'')
  };
  const schemeBtns = ['fixed','ascending','descending','pyramid','valley'].map(s => {
    const active = mpOverride && mpScheme === s;
    return `<button type="button" data-scheme="${s}"
      onclick="setMovRepsScheme('${blockId}',${idx},'${s}',this)"
      style="padding:5px 3px;border-radius:7px;border:1.5px solid ${active?'var(--brand)':'var(--border)'};background:${active?'var(--brand)':'var(--surface2)'};color:${active?'white':'var(--text)'};font-size:.6rem;font-weight:800;cursor:pointer;font-family:inherit;text-align:center;opacity:${mpOverride?'1':'0.45'};">${schemeLabels[s]}</button>`;
  }).join('');
  const ovDiv = document.createElement('div');
  ovDiv.className = 'field-stack rep-override-section';
  ovDiv.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
  // Build rep sequence preview using live start value
  const _mpSeq = (mpOverride && mpScheme !== 'fixed') ? (() => {
    const seq = [];
    if (mpScheme === 'ascending')  { for(let i=0;i<mpRounds;i++) seq.push(Math.max(1,mpStart+mpInc*i)); }
    else if (mpScheme === 'descending') { for(let i=0;i<mpRounds;i++) seq.push(Math.max(1,mpStart-mpInc*i)); }
    else if (mpScheme === 'pyramid') {
      const h=Math.ceil(mpRounds/2);
      for(let i=0;i<h;i++) seq.push(Math.max(1,mpStart+mpInc*i));
      for(let i=h-2;i>=0;i--) seq.push(Math.max(1,mpStart+mpInc*i));
    } else if (mpScheme === 'valley') {
      const h=Math.ceil(mpRounds/2);
      for(let i=0;i<h;i++) seq.push(Math.max(1,mpStart-mpInc*i));
      for(let i=h-2;i>=0;i--) seq.push(Math.max(1,mpStart-mpInc*i));
    }
    return seq.length ? seq : null;
  })() : null;
  const _mpArrow = mpScheme==='descending'?'↓':mpScheme==='ascending'?'↑':mpScheme==='pyramid'?'△':'▽';
  const _mpPreviewHTML = _mpSeq && _mpSeq.length ? `
    <div style="background:var(--glass-inner);border:0.5px solid var(--glass-border);border-radius:8px;padding:8px 10px;margin-top:6px;margin-bottom:8px;">
      <div style="font-size:.7rem;font-weight:800;color:var(--brand);text-align:center;letter-spacing:.04em;">${_mpSeq.join(' → ')}</div>
      <div style="font-size:.65rem;color:var(--label);text-align:center;margin-top:2px;">${_mpSeq[0]}→${_mpSeq[_mpSeq.length-1]} (${_mpArrow}${mpInc} reps)</div>
    </div>` : '';

  ovDiv.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="font-size:.65rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;">${t('block.reps.override')}</span>
      <label class="toggle-switch" style="margin:0;">
        <input type="checkbox" class="mov-reps-toggle" ${mpOverride?'checked':''}
          onchange="toggleMovRepsOverride('${blockId}',${idx},this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    ${mpOverride ? `
    <div style="font-size:.65rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${t('block.reps.scheme')||'Rep Scheme'}</div>
    <div class="mov-reps-scheme-wrap" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:4px;">
      ${schemeBtns}
    </div>
    <div class="mov-reps-inc-wrap" style="display:${mpScheme!=='fixed'?'block':'none'};margin-top:6px;">
      <div class="field-stack"><label>${t('block.reps.increment')}</label>${makePicker('_reps_inc_'+idx, mpInc, VALS.reps, t('block.reps.increment'))}</div>
      ${_mpPreviewHTML}
    </div>` : ''}`;
  // Wire increment picker — re-render to update sequence preview
  const incTrig = ovDiv.querySelector('.picker-trigger');
  if (incTrig) incTrig.onclick = function() {
    openPickerWithCallback(this, (val) => {
      mb.querySelector('.m-reps-inc').value = val;
      _reRenderMovEditorPreserveExpanded(blockId, idx);
      updateBlueprint();
    });
  };
  return ovDiv;
}

// Only rendered for one-directional movements (oneDir:true) — cyclical
// movements always get full eccentric credit unconditionally, so there's
// nothing for the athlete to decide for those.
function _buildEccentricToggleUI(mb, blockId, idx) {
  const name = mb.querySelector('input[type="hidden"]')?.value || '';
  const p = MASTER_DB[name];
  if (!p || !p.oneDir) return null;
  const controlled = mb.querySelector('.m-controlled-descent')?.value !== '0';
  const div = document.createElement('div');
  div.className = 'field-stack';
  div.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="flex:1;margin-right:10px;">
        <div style="font-size:.68rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;">${t('block.controlled.descent')}</div>
        <div style="font-size:.65rem;color:var(--label);margin-top:2px;line-height:1.4;">${controlled ? t('block.controlled.descent.on') : t('block.controlled.descent.off')}</div>
      </div>
      <label class="toggle-switch" style="margin:0;">
        <input type="checkbox" ${controlled?'checked':''}
          onchange="toggleControlledDescent('${blockId}',${idx},this.checked);_reRenderMovEditorPreserveExpanded('${blockId}',${idx})">
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  return div;
}

function _reRenderMovEditorPreserveExpanded(blockId, mvIdx) {
  const expandedInPanel = new Set();
  const panelBody = document.getElementById('movement-panel-body');
  panelBody?.querySelectorAll('.movement-row').forEach((r, i) => {
    if (r.classList.contains('expanded')) expandedInPanel.add(i);
  });
  const expandedInDetail = new Set();
  const detList = document.getElementById('detail-movlist-' + blockId);
  detList?.querySelectorAll('.movement-row').forEach((r, i) => {
    if (r.classList.contains('expanded')) expandedInDetail.add(i);
  });
  // Re-render
  if (_openMovBlockId === blockId) renderMovementPanel(blockId);
  if (_openBlockId === blockId) renderDetailMovements(blockId);
  // Restore expanded state
  panelBody?.querySelectorAll('.movement-row').forEach((r, i) => {
    if (expandedInPanel.has(i)) r.classList.add('expanded');
  });
  detList?.querySelectorAll('.movement-row').forEach((r, i) => {
    if (expandedInDetail.has(i)) r.classList.add('expanded');
  });
}

function toggleMovementEditor(row) {
  row.classList.toggle('expanded');
}

function toggleMovRepsOverride(blockId, mvIdx, active) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const mb = block.querySelectorAll('.movement-block')[mvIdx];
  if (!mb) return;
  mb.querySelector('.m-reps-override').value = active ? '1' : '0';
  _reRenderMovEditorPreserveExpanded(blockId, mvIdx);
  updateBlueprint();
}

// Per-movement-instance "controlled descent" toggle — only relevant for
// one-directional movements (oneDir:true in MASTER_DB), since cyclical
// movements always get full eccentric credit unconditionally regardless
// of this setting. Only affects mc_mech (Structural Fatigue), never wd
// (Power) — see the memory-recorded settled design.
function toggleControlledDescent(blockId, mvIdx, controlled) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const mb = block.querySelectorAll('.movement-block')[mvIdx];
  if (!mb) return;
  const el = mb.querySelector('.m-controlled-descent');
  if (el) el.value = controlled ? '1' : '0';
  updateBlueprint();
}

function setMovRepsScheme(blockId, mvIdx, scheme, btn) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const mb = block.querySelectorAll('.movement-block')[mvIdx];
  if (!mb) return;
  if (mb.querySelector('.m-reps-override')?.value !== '1') return;
  mb.querySelector('.m-reps-scheme').value = scheme;
  _reRenderMovEditorPreserveExpanded(blockId, mvIdx);
  updateBlueprint();
}



function removeMovement(blockId, idx) {
  const block = document.getElementById(blockId);
  const moves = block.querySelectorAll('.movement-block');
  if (moves[idx]) { moves[idx].remove(); updateBlueprint(); renderDetailMovements(blockId); }
}

function syncDetailSummary(id) {
  // Update block list button sub-text live while in detail
  renderBlockList();
  // Also refresh movement count sub-label on the movements button
  if (_openBlockId === id) {
    const block = document.getElementById(id);
    const sub = document.getElementById('mov-btn-sub-' + id);
    if (sub && block) {
      const c = block.querySelectorAll('.movement-block').length;
      sub.textContent = c ? c + ' ' + (c!==1 ? t('builder.movements') : t('builder.movement')) : t('builder.tap.movements');
    }
    renderBlockOverview(id);
  }
}

/* Render compact block overview inside block detail panel */
function renderBlockOverview(id) {
  const card = document.getElementById('block-overview-' + id);
  if (!card) return;
  const block = document.getElementById(id);
  if (!block) return;
  const mode = block.querySelector('.b-mode').value.toUpperCase();
  const modeLabel = getModeLabel(block, mode);
  const moves = block.querySelectorAll('.movement-block');
  let movLines;
  if (mode === 'EXMOM') {
    const moves = block.querySelectorAll('.movement-block');
    movLines = Array.from(moves).map((mv, si) => {
      const key  = mv.querySelector('input[type="hidden"]')?.value || '';
      const reps = mv.querySelector('.m-reps')?.value || '0';
      const kg   = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
      const kgStr = kg === 0 ? 'BW' : kg === 999 ? 'Max kg' : kg + 'kg';
      return `<div style="font-size:.73rem;color:var(--label);padding:2px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--accent);font-weight:800;">${t('exmom.station')} ${si+1}:</span> ${reps} ${key} @ ${kgStr}
      </div>`;
    }).join('');
  } else {
    movLines = buildRoundByRound(block, { dark: false });
  }
  let emomLine = '';
  const emomAccOv = block.querySelector('.emom-accordion');
  if (emomAccOv?.classList.contains('penalty-on')) {
    const pmOv = block.querySelector('.emom-accordion .m-search')?.value
              || block.querySelector('.int-key')?.value || 'Penalty move';
    const irOv = block.querySelector('.int-reps')?.value || '0';
    const iwOv = block.querySelector('.int-wt')?.value   || '0';
    const isOv = block.querySelector('.int-sec')?.value  || '60';
    const intWtInpOv = block.querySelector('.int-wt');
    const isBWOv = intWtInpOv?.disabled || MASTER_DB[pmOv]?.type === 'bw';
    const iwOvL = isBWOv ? 'BW' : (parseFloat(iwOv) > 0 ? iwOv + 'kg' : '0kg');
    emomLine = `<div style="padding:4px 0;font-size:.75rem;color:#F59E0B;border-bottom:1px solid var(--border);">⚡ EMOM Penalty: ${pmOv} ×${irOv} @ ${iwOvL} every ${isOv}s</div>`;
  }
  const hasContent = movLines || emomLine;
  card.innerHTML = `
    <div style="font-size:.7rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">${t('block.overview')}</div>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;">
      <div style="font-size:.78rem;font-weight:800;color:var(--brand);margin-bottom:${hasContent?'8px':'0'};">${mode} · ${modeLabel}</div>
      ${movLines}${emomLine}
      ${!hasContent ? `<div style="font-size:.75rem;color:var(--label);font-style:italic;">${t('block.no.movements')}</div>` : ''}
    </div>`;
}

/* ════════════════════════════════════════════════════
   LADDER REP SCHEME
════════════════════════════════════════════════════ */

function getLadderSequence(block) {
  const type = block.querySelector('.b-ladder-type')?.value || 'fixed';
  if (type === 'fixed') return null;
  const start = parseInt(block.querySelector('.b-ladder-start')?.value) || 5;
  const inc   = parseInt(block.querySelector('.b-ladder-inc')?.value)   || 5;
  const mode  = block.querySelector('.b-mode')?.value || 'fortime';

  // Rounds source:
  // ForTime → use Goal Rounds (b-target)
  // EMOM    → use Total Intervals (b-total-int)
  let rounds;
  if (mode === 'emom' || mode === 'exmom') {
    rounds = parseInt(block.querySelector('.b-total-int')?.value) || 3;
  } else {
    // fortime — use Goal Rounds field
    rounds = parseInt(block.querySelector('.b-target')?.value) || 3;
  }

  // Pyramid / Valley: rounds must be odd
  if ((type === 'pyramid' || type === 'valley') && rounds % 2 === 0) rounds = Math.max(3, rounds - 1);

  const seq = [];
  if (type === 'ascending') {
    for (let i = 0; i < rounds; i++) seq.push(start + inc * i);
  } else if (type === 'descending') {
    for (let i = 0; i < rounds; i++) seq.push(Math.max(1, start - inc * i));
  } else if (type === 'pyramid') {
    const half = Math.ceil(rounds / 2);
    for (let i = 0; i < half; i++)      seq.push(start + inc * i);
    for (let i = half - 2; i >= 0; i--) seq.push(start + inc * i);
  } else if (type === 'valley') {
    // Valley ▽: descend to minimum then ascend back — mirror of pyramid
    const half = Math.ceil(rounds / 2);
    for (let i = 0; i < half; i++)      seq.push(Math.max(1, start - inc * i));
    for (let i = half - 2; i >= 0; i--) seq.push(Math.max(1, start - inc * i));
  }
  return seq.filter(v => v > 0);
}

// Per-movement rep override sequence (mirrors getWtLadderSequence)
function getMovRepsSequence(mb, rounds) {
  if (mb.querySelector('.m-reps-override')?.value !== '1') return null;
  const type  = mb.querySelector('.m-reps-scheme')?.value || 'fixed';
  const start = parseInt(mb.querySelector('.m-reps')?.value) || 0;
  const inc   = parseInt(mb.querySelector('.m-reps-inc')?.value) || 5;
  if (type === 'fixed') return null;
  const seq = [];
  if (type === 'ascending')  { for (let i=0;i<rounds;i++) seq.push(Math.max(1, start + inc*i)); }
  else if (type === 'descending') { for (let i=0;i<rounds;i++) seq.push(Math.max(1, start - inc*i)); }
  else if (type === 'pyramid') {
    const half = Math.ceil(rounds/2);
    for (let i=0;i<half;i++)      seq.push(Math.max(1, start + inc*i));
    for (let i=half-2;i>=0;i--)   seq.push(Math.max(1, start + inc*i));
  } else if (type === 'valley') {
    const half = Math.ceil(rounds/2);
    for (let i=0;i<half;i++)      seq.push(Math.max(1, start - inc*i));
    for (let i=half-2;i>=0;i--)   seq.push(Math.max(1, start - inc*i));
  }
  return seq.length ? seq : null;
}

function fmtMovRepsScheme(mb, rounds) {
  if (mb.querySelector('.m-reps-override')?.value !== '1') return null;
  const type  = mb.querySelector('.m-reps-scheme')?.value || 'fixed';
  const start = parseInt(mb.querySelector('.m-reps')?.value) || 0;
  const inc   = parseInt(mb.querySelector('.m-reps-inc')?.value) || 5;
  if (type === 'fixed') return `${start}`;
  const arrow = type==='descending'?'↓':type==='ascending'?'↑':type==='pyramid'?'△':'▽';
  if (type === 'ascending' || type === 'descending') {
    const end = Math.max(1, start + (type==='ascending'?1:-1)*inc*(rounds-1));
    return `${start}→${end}`;
  }
  const half = Math.ceil(rounds/2);
  const ext  = type==='pyramid' ? Math.max(1,start+inc*(half-1)) : Math.max(1,start-inc*(half-1));
  return `${start}→${ext}→${start}`;
}

function getLadderTotalReps(block, baseReps, completedRounds, extraReps) {
  const seq = getLadderSequence(block);
  if (!seq || !seq.length) return (baseReps||0) * (completedRounds||1) + (extraReps||0);
  // Sum only the completed rounds of the ladder sequence
  const rounds = (completedRounds !== undefined && completedRounds !== null) ? completedRounds : seq.length;
  let total = 0;
  for (let i = 0; i < Math.min(rounds, seq.length); i++) total += seq[i];
  return total + (extraReps || 0);
}

function setLadderType(blockId, type) {
  const block = document.getElementById(blockId);
  if (!block) return;

  // Update hidden input on the ORIGINAL block
  block.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = type);

  // For pyramid: snap Goal Rounds to nearest odd (only if currently even)
  // For other types: restore full picker range
  const targetInp = block.querySelector('.b-target');
  if (targetInp) {
    if (type === 'pyramid' || type === 'valley') {
      targetInp.dataset.pickerValues = VALS.oddRnds.join(',');
      const cur = parseInt(targetInp.value) || 5;
      if (cur % 2 === 0) {
        const snapped = Math.max(3, cur - 1);
        targetInp.value = snapped;
      }
    } else {
      targetInp.dataset.pickerValues = VALS.goalRnds.join(',');
    }
  }

  // Update ALL ladder UI containers — both in original block AND detail panel clone
  const allContainers = [block];
  const detailCfg = document.getElementById('detail-cfg-' + blockId);
  if (detailCfg) allContainers.push(detailCfg);

  allContainers.forEach(container => {
    container.querySelectorAll('.ladder-type-btn').forEach(btn => {
      const active = btn.dataset.type === type;
      btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
      btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
      btn.style.color       = active ? 'white'        : 'var(--text)';
    });
    container.querySelectorAll('.ladder-fields').forEach(f => {
      f.style.display = type === 'fixed' ? 'none' : '';
    });
    // Sync Goal Rounds picker values for pyramid — use value from original block
    const tTrigger = [...container.querySelectorAll('.picker-trigger')].find(t => t.querySelector('.b-target'));
    if (tTrigger) {
      const tInp = tTrigger.querySelector('input[type="number"]');
      if (tInp) {
        tInp.dataset.pickerValues = (type === 'pyramid' || type === 'valley') ? VALS.oddRnds.join(',') : VALS.goalRnds.join(',');
        // Sync display value from original block (already snapped above)
        const correctVal = targetInp ? parseInt(targetInp.value) : parseInt(tInp.value);
        tInp.value = correctVal;
        tTrigger.querySelector('.picker-trigger-val').textContent = correctVal;
      }
    }
  });

  // Update preview AFTER all values are set
  updateLadderPreview(blockId);
  updateBlockMovementsForLadder(blockId);
  updateBlueprint();
  syncDetailSummary(blockId);
  autoSave();
}

function updateLadderPreview(blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const seq = getLadderSequence(block);
  const previewText = seq && seq.length
    ? seq.join(' — ') + `  (${t('ladder.preview')}: ${seq.reduce((s,v)=>s+v,0)} reps)`
    : '';

  // Update in original block AND detail panel
  [block, document.getElementById('detail-cfg-' + blockId)].forEach(container => {
    if (!container) return;
    container.querySelectorAll('.ladder-preview').forEach(el => {
      el.textContent = previewText;
    });
  });
}

function updateBlockMovementsForLadder(blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const seq = getLadderSequence(block);
  const start = parseInt(block.querySelector('.b-ladder-start')?.value) || 5;
  block.querySelectorAll('.movement-block').forEach(mb => {
    const repsInp = mb.querySelector('.m-reps');
    if (!repsInp) return;
    // Don't overwrite reps for movements with their own override
    const hasOverride = mb.querySelector('.m-reps-override')?.value === '1';
    if (hasOverride) return;
    if (seq) {
      repsInp.value = start;
      repsInp.dataset.ladderLocked = '1';
    } else {
      delete repsInp.dataset.ladderLocked;
    }
  });
  // Refresh detail panel movement display if open
  if (_openBlockId === blockId) {
    renderDetailMovements(blockId);
  }
}

function getWtLadderSequence(mb, rounds) {
  const type  = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
  if (type === 'fixed') return null;
  const start = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
  const inc   = parseFloat(mb.querySelector('.m-wt-ladder-inc')?.value) || 5;
  const seq = [];
  if (type === 'ascending') {
    for (let i = 0; i < rounds; i++) seq.push(Math.max(0, Math.round((start + inc * i) * 10) / 10));
  } else if (type === 'descending') {
    for (let i = 0; i < rounds; i++) seq.push(Math.max(0, Math.round((start - inc * i) * 10) / 10));
  } else if (type === 'pyramid') {
    const half = Math.ceil(rounds / 2);
    for (let i = 0; i < half; i++)      seq.push(Math.max(0, Math.round((start + inc * i) * 10) / 10));
    for (let i = half - 2; i >= 0; i--) seq.push(Math.max(0, Math.round((start + inc * i) * 10) / 10));
  } else if (type === 'valley') {
    const half = Math.ceil(rounds / 2);
    for (let i = 0; i < half; i++)      seq.push(Math.max(0, Math.round((start - inc * i) * 10) / 10));
    for (let i = half - 2; i >= 0; i--) seq.push(Math.max(0, Math.round((start - inc * i) * 10) / 10));
  }
  return seq.length ? seq : null;
}

function fmtWtScheme(mb, rounds) {
  // Compact: start→end kg (+inc/rd) or start→peak→start for pyramid/valley
  const type  = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
  const start = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
  const inc   = parseFloat(mb.querySelector('.m-wt-ladder-inc')?.value) || 5;
  if (type === 'fixed') return null;
  const startStr = start === 0 ? 'BW' : start + 'kg';
  const sign  = type === 'descending' ? '−' : '+';
  const arrow = type === 'descending' ? '↓' : type === 'ascending' ? '↑' : type === 'pyramid' ? '△' : '▽';
  if (type === 'ascending' || type === 'descending') {
    const end = Math.max(0, Math.round((start + (type === 'ascending' ? 1 : -1) * inc * (rounds - 1)) * 10) / 10);
    const endStr = end === 0 ? 'BW' : end + 'kg';
    return `${startStr}→${endStr} (${arrow}${inc}kg)`;
  }
  // Pyramid / Valley: start → peak/valley → start
  const half = Math.ceil(rounds / 2);
  const extreme = type === 'pyramid'
    ? Math.round((start + inc * (half - 1)) * 10) / 10
    : Math.max(0, Math.round((start - inc * (half - 1)) * 10) / 10);
  const extremeStr = extreme === 0 ? 'BW' : extreme + 'kg';
  return `${startStr}→${extremeStr}→${startStr} (${arrow}${inc}kg)`;
}


function getWtAtRound(mb, round0) {
  const type = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
  if (type === 'fixed') return parseFloat(mb.querySelector('.m-wt')?.value) || 0;
  const start = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
  const inc   = parseFloat(mb.querySelector('.m-wt-ladder-inc')?.value) || 5;
  // For pyramid/valley the sequence shape depends on total rounds — must use actual total
  // For ascending/descending the shape is independent of total length
  const block = mb.closest('.wod-block');
  const mode  = block?.querySelector('.b-mode')?.value || 'fortime';
  const actualTotal = (mode === 'emom' || mode === 'exmom')
    ? parseInt(block?.querySelector('.b-total-int')?.value) || (round0 + 1)
    : parseInt(block?.querySelector('.b-target')?.value)    || (round0 + 1);
  // Use actual total for pyramid/valley (shape-sensitive), generous size for ascending/descending
  const seqLen = (type === 'pyramid' || type === 'valley')
    ? Math.max(actualTotal, round0 + 1)
    : (round0 + 1) * 2;
  const seq = getWtLadderSequence(mb, seqLen);
  if (!seq) return start;
  return seq[round0] !== undefined ? seq[round0] : seq[seq.length - 1];
}

function setWtLadderType(blockId, mvIdx, type) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const mb = block.querySelectorAll('.movement-block')[mvIdx];
  if (!mb) return;
  const typeInp = mb.querySelector('.m-wt-ladder-type');
  if (typeInp) typeInp.value = type;
  // Re-render only the weight ladder section in the open movement row
  const panelBody = document.getElementById('movement-panel-body');
  const rows = panelBody?.querySelectorAll('.movement-row');
  const row = rows?.[mvIdx];
  if (row) {
    const wtLadderWrap = row.querySelector('.wt-ladder-wrap');
    if (wtLadderWrap) _rebuildWtLadderUI(wtLadderWrap, blockId, mvIdx, mb);
    // Update subtitle
    const subEl = row.querySelector('.movement-row-sub');
    if (subEl) {
      const repSeq = getLadderSequence(block);
      const rounds = repSeq ? repSeq.length : (parseInt(block.querySelector('.b-target')?.value) || 1);
      const wtSeq = type !== 'fixed' ? getWtLadderSequence(mb, rounds) : null;
      const kg = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
      const kgLabel = kg === 0 ? 'BW' : kg + ' kg';
      const kgDisp = type !== 'fixed' ? (fmtWtScheme(mb, rounds) || kgLabel) : kgLabel;
      const reps = mb.querySelector('.m-reps')?.value || '0';
      const repDisp = repSeq ? getLadderRepsDisplay(block, reps) : null;
      subEl.textContent = repDisp ? `${repDisp} @ ${kgDisp}` : `×${reps} @ ${kgDisp}`;
    }
  }
  updateBlueprint();
  syncDetailSummary(blockId);
  autoSave();
}

function _rebuildWtLadderUI(wrap, blockId, mvIdx, mb) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const repSeq = getLadderSequence(block);
  const rounds = repSeq ? repSeq.length : (parseInt(block.querySelector('.b-target')?.value) || 1);
  const wtLadderType = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
  const wtLadderInc  = parseFloat(mb.querySelector('.m-wt-ladder-inc')?.value) || 5;
  const wtSeq = getWtLadderSequence(mb, rounds);
  const wtBtns = ['fixed','ascending','descending','pyramid','valley'].map(tp => {
    const active = wtLadderType === tp;
    const labels = {fixed:t('ladder.wt.fixed'), ascending:t('ladder.wt.asc'), descending:t('ladder.wt.desc'), pyramid:t('ladder.wt.pyramid'), valley:t('ladder.wt.valley')};
    return `<button onclick="setWtLadderType('${blockId}',${mvIdx},'${tp}')" style="padding:5px 3px;border-radius:7px;border:1.5px solid ${active?'var(--brand)':'var(--border)'};background:${active?'var(--brand)':'var(--surface2)'};color:${active?'white':'var(--text)'};font-size:.6rem;font-weight:800;cursor:pointer;font-family:inherit;text-align:center;">${labels[tp]}</button>`;
  }).join('');
  const _fmtCompact = wtLadderType !== 'fixed' ? fmtWtScheme(mb, rounds) : null;
  // Full sequence preview for the editor (like the rep ladder in modality accordion)
  const _fullWtSeq = wtSeq ? wtSeq.map(w => w === 0 ? 'BW' : w + 'kg').join(' → ') : null;
  const _totalKg = wtSeq ? wtSeq.reduce((s, w) => s + w, 0) : 0;
  const _fullRepSeq = repSeq ? repSeq.join(' → ') : null;
  const _totalReps = repSeq ? repSeq.reduce((a, b) => a + b, 0) : null;
  const wtPreview = _fullWtSeq ? `
    <div style="background:var(--glass-inner);border:0.5px solid var(--glass-border);border-radius:8px;padding:8px 10px;margin-top:6px;margin-bottom:4px;">
      <div style="font-size:.7rem;font-weight:800;color:var(--brand);text-align:center;letter-spacing:.04em;">${_fullWtSeq}</div>
      <div style="font-size:.65rem;color:var(--label);text-align:center;margin-top:2px;">${_fmtCompact}</div>
    </div>` : '';
  const wtFields = wtLadderType !== 'fixed' ? `<div class="field-stack" style="margin-top:6px;"><label>${t('ladder.wt.inc')}</label>${makePicker('_mp_wt_inc_'+mvIdx, wtLadderInc, [1,2.5,5,7.5,10,12.5,15,20,25], t('ladder.wt.inc'))}</div>${wtPreview}` : '';
  wrap.innerHTML = `<div style="font-size:.65rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${t('ladder.wt.scheme')}</div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:4px;">${wtBtns}</div>${wtFields}`;
  // Wire increment picker
  if (wtLadderType !== 'fixed') {
    const incTrig = wrap.querySelector('.picker-trigger');
    if (incTrig) incTrig.onclick = function() {
      openPickerWithCallback(this, (val) => {
        const ii = mb.querySelector('.m-wt-ladder-inc'); if (ii) ii.value = val;
        _rebuildWtLadderUI(wrap, blockId, mvIdx, mb);
        updateBlueprint(); syncDetailSummary(blockId); autoSave();
      });
    };
  }
}

function getLadderRepsDisplay(block, baseReps) {
  const seq = getLadderSequence(block);
  if (!seq || !seq.length) return null;
  const type  = block.querySelector('.b-ladder-type')?.value || 'fixed';
  const start = seq[0];
  const inc   = parseInt(block.querySelector('.b-ladder-inc')?.value) || 1;
  const arrow = type === 'descending' ? '↓' : type === 'ascending' ? '↑' : type === 'pyramid' ? '△' : '▽';
  if (type === 'ascending' || type === 'descending') {
    const end = seq[seq.length - 1];
    return `${start}→${end} (${arrow}${inc} reps)`;
  }
  // Pyramid / Valley: start → peak/valley → start
  const half = Math.ceil(seq.length / 2);
  const extreme = seq[half - 1];
  return `${start}→${extreme}→${start} (${arrow}${inc} reps)`;
}
let _openMovBlockId = null;

function openMovementPanel(blockId) {
  _openMovBlockId = blockId;
  const block = document.getElementById(blockId);
  const idx = [...document.querySelectorAll('.wod-block')].indexOf(block);
  document.getElementById('movement-panel-title').textContent = `${t('builder.block.n')} ${idx+1} — ${t('block.movements.btn')}`;
  renderMovementPanel(blockId);
  const movPanel = document.getElementById('movement-panel');
  movPanel.scrollTop = 0;
  movPanel.classList.add('open');
  requestAnimationFrame(() => { movPanel.scrollTop = 0; });
  const screen = document.getElementById('screen-builder');
  if (screen) screen.scrollTop = 0;
  // Lock parent scroll to prevent overscroll bleeding through
  const parentScreen = document.getElementById('screen-builder');
  if (parentScreen) parentScreen.style.overflow = 'hidden';
  const blockDetailPanel = document.getElementById('block-detail-panel');
  if (blockDetailPanel) blockDetailPanel.style.overflow = 'hidden';
  // Show movement FAB, hide builder FAB
  document.getElementById('movement-fab').classList.add('visible');
  document.querySelector('.builder-fab').style.display = 'none';
}

function closeMovementPanel() {
  document.getElementById('movement-panel').classList.remove('open');
  // Restore parent scroll
  const parentScreen = document.getElementById('screen-builder');
  if (parentScreen) parentScreen.style.overflow = '';
  const blockDetailPanel = document.getElementById('block-detail-panel');
  if (blockDetailPanel) blockDetailPanel.style.overflow = '';
  document.getElementById('movement-fab').classList.remove('visible');
  _openMovBlockId = null;
  if (_openBlockId) {
    const block = document.getElementById(_openBlockId);
    // Refresh movements button sub-label
    const sub = document.getElementById('mov-btn-sub-' + _openBlockId);
    if (sub && block) {
      const c = block.querySelectorAll('.movement-block').length;
      sub.textContent = c ? c + ' ' + (c!==1 ? t('builder.movements') : t('builder.movement')) : t('builder.tap.movements');
    }
    // Refresh block overview with latest movements
    renderBlockOverview(_openBlockId);
  }
  updateBlueprint();
}

function addMovementFromFAB() {
  if (window._activeBoxSession) { showToast(t('toast.locked.session')); return; }
  if (!_openMovBlockId) return;
  addManualRow(_openMovBlockId);
  renderMovementPanel(_openMovBlockId);
}

function renderMovementPanel(blockId) {
  const block = document.getElementById(blockId);
  const panelBody = document.getElementById('movement-panel-body');
  if (!block || !panelBody) return;
  panelBody.innerHTML = '';

  const mode = block.querySelector('.b-mode').value;
  const isT = mode === 'tabata';
  const moves = block.querySelectorAll('.movement-block');

  // Overview card
  const overview = document.createElement('div');
  overview.className = 'mov-overview';
  const ovTitle = document.createElement('div');
  ovTitle.className = 'mov-overview-title';
  ovTitle.textContent = `${moves.length} ${moves.length !== 1 ? t('builder.movements') : t('builder.movement')}`;
  overview.appendChild(ovTitle);

  if (!moves.length) {
    const empty = document.createElement('div');
    empty.className = 'mov-overview-empty';
    empty.innerHTML = `<div style="font-size:2rem;margin-bottom:8px;">💪</div><p>${t('empty.movements')}</p>`;
    overview.appendChild(empty);
    panelBody.appendChild(overview);
    return;
  }

  // Movement rows — same accordion-style as before
  moves.forEach((mb, idx) => {
    const name = mb.querySelector('.m-search').value || t('builder.movement.n') + ' ' + (idx+1);
    const reps = mb.querySelector('.m-reps')?.value || '0';
    const _rawKg = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
    const kg   = _rawKg === 999 ? (parseFloat(mb.querySelector('.m-wt')?.dataset?.maxKgEntered) || 0) : _rawKg;
    const kgLabel = _rawKg === 999 ? 'Max kg' : (kg == 0 ? 'BW' : kg + ' kg');
    const _phNote3 = _rawKg > 0 && _rawKg !== 999 ? getPerHandNote(name, _rawKg) : '';
    const kgLabelPH3 = kgLabel + (_phNote3 ? ' (' + _phNote3 + ')' : '');
    const _ladderDisp2 = !isT ? getLadderRepsDisplay(block, reps) : null;
    const _wtTypeMR = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
    const _roundsMR = getLadderSequence(block)?.length || (parseInt(block.querySelector('.b-target')?.value) || 1);
    const _wtSeqMR  = !isT && _wtTypeMR !== 'fixed' ? getWtLadderSequence(mb, _roundsMR) : null;
    const kgDispMR  = _wtTypeMR !== 'fixed' ? (fmtWtScheme(mb, _roundsMR) || kgLabelPH3) : kgLabelPH3;
    // Override rep display
    const _repsOvActive = mb.querySelector('.m-reps-override')?.value === '1';
    const _repsOvScheme = mb.querySelector('.m-reps-scheme')?.value || 'fixed';
    const _repsOvInc    = parseInt(mb.querySelector('.m-reps-inc')?.value) || 5;
    const _repsOvStart  = parseInt(reps) || 0;
    let _repsDisp = _ladderDisp2 || (parseFloat(reps) === 999 ? t('builder.max.reps') : `×${reps}`);
    if (_repsOvActive) {
      if (_repsOvScheme === 'fixed') {
        _repsDisp = `×${_repsOvStart}`;
      } else {
        // Build compact: start→end (arrow + inc reps)
        const _ovSeq2 = getMovRepsSequence(mb, _roundsMR);
        const _ovArrow = _repsOvScheme==='descending'?'↓':_repsOvScheme==='ascending'?'↑':_repsOvScheme==='pyramid'?'△':'▽';
        if (_ovSeq2 && _ovSeq2.length) {
          _repsDisp = `×${_ovSeq2[0]}→×${_ovSeq2[_ovSeq2.length-1]} (${_ovArrow}${_repsOvInc})`;
        }
      }
    }
    const sub  = isT ? kgDispMR : (`${_repsDisp} @ ${kgDispMR}`);

    const row = document.createElement('div');
    row.className = 'movement-row';
    row.innerHTML = `
      <div class="movement-row-header" onclick="toggleMovementEditor(this.closest('.movement-row'))">
        <div class="mv-drag-handle" onclick="event.stopPropagation()">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="3" y1="4" x2="13" y2="4"/>
            <line x1="3" y1="8" x2="13" y2="8"/>
            <line x1="3" y1="12" x2="13" y2="12"/>
          </svg>
        </div>
        <div class="movement-row-icon">${idx+1}</div>
        <div style="flex:1;min-width:0;">
          <div class="movement-row-name">${name}</div>
          <span class="movement-row-sub">${sub}</span>
        </div>
        <button class="movement-row-del" onclick="event.stopPropagation();removeMov('${blockId}',${idx})">✕</button>
        <span class="movement-row-chevron">▼</span>
      </div>
      <div class="movement-editor"><div class="movement-editor-inner"></div></div>`;

    const editorInner = row.querySelector('.movement-editor-inner');

    // Search field
    const sc = document.createElement('div');
    sc.className = 'search-container';
    sc.style.cssText = 'margin-bottom:10px;margin-top:12px;';
    sc.innerHTML = `<label data-i18n="block.exercise">Exercise</label>
      <div class="search-wrap">
        <input type="text" class="m-search" value="${mb.querySelector('.m-search').value}" placeholder="Search movement…" data-i18n-placeholder="search.movement" oninput="handleSearch(this)">
        <div class="search-results"></div>
      </div>
      <input type="hidden" value="${mb.querySelector('input[type=hidden]').value}">`;
    editorInner.appendChild(sc);

    // Reps picker
    if (!isT) {
      const repWrap = document.createElement('div');
      repWrap.className = 'field-stack';
      const ladderSeqMP = getLadderSequence(block);
      const ladderDisplayMP = ladderSeqMP ? getLadderRepsDisplay(block, reps) : null;
      const mpOverrideActive = mb.querySelector('.m-reps-override')?.value === '1';
      if (ladderDisplayMP && !mpOverrideActive) {
        // Ladder mode — show scheme locked in brand orange
        repWrap.innerHTML = `<label data-i18n="block.reps.round">${t('block.reps.round')}</label>
          <div class="picker-trigger" style="opacity:.6;pointer-events:none;cursor:default;">
            <span class="picker-trigger-val" style="color:var(--brand);font-weight:800;">${ladderDisplayMP}</span>
          </div>`;
      } else {
        const repLabel = mpOverrideActive ? t('block.reps.override') + ' — ' + t('block.reps.start')||'Start Reps' : t('block.reps.round');
        repWrap.innerHTML = `<label>${repLabel}</label>` + makePicker('_mp_reps_'+idx, parseInt(reps)||0, VALS.reps, 'Reps');
        repWrap.querySelector('.picker-trigger').onclick = function() {
          openPickerWithCallback(this, (val) => {
            const origReps = mb.querySelector('.m-reps');
            if (origReps) { origReps.value = val; origReps.dispatchEvent(new Event('input',{bubbles:true})); }
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, t('builder.reps'));
            const curKg = mb.querySelector('.m-wt')?.value || '0';
            const _wtTypeU2 = mb.querySelector('.m-wt-ladder-type')?.value || 'fixed';
            const _repSeqU2 = getLadderSequence(block);
            const _roundsU2 = _repSeqU2 ? _repSeqU2.length : (parseInt(block.querySelector('.b-target')?.value)||1);
            const _wtSeqU2 = _wtTypeU2 !== 'fixed' ? getWtLadderSequence(mb, _roundsU2) : null;
            const _kgU2 = curKg==0?'BW':curKg+' kg';
            const _kgLabelU2 = _wtTypeU2 !== 'fixed' ? (fmtWtScheme(mb, _roundsU2) || _kgU2) : _kgU2;
            row.querySelector('.movement-row-sub').textContent = `×${val} @ ${_kgLabelU2}`;
            // If override active re-render to update sequence preview
            if (mb.querySelector('.m-reps-override')?.value === '1') {
              _reRenderMovEditorPreserveExpanded(blockId, idx);
            }
            updateMovOverviewTitle(blockId);
          });
        };
      }
      editorInner.appendChild(repWrap);
    }

    // Weight picker
    const wtDisabled = mb.querySelector('.m-wt')?.disabled;
    const rawKgForPicker = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
    const kgForDisplay   = rawKgForPicker; // keep 999 so formatPickerVal shows "Max kg"
    const perHandLabel = rawKgForPicker > 0 && rawKgForPicker !== 999 ? getPerHandNote(mb.querySelector('.m-search')?.value || '', rawKgForPicker) : '';
    const kgWrap = document.createElement('div');
    kgWrap.className = 'field-stack';
    kgWrap.innerHTML = `<label>Weight (kg)${perHandLabel ? ' <span style="font-size:.65rem;color:var(--label);">(' + perHandLabel + ')</span>' : ''}</label>` + makePicker('_mp_kg_'+idx, kgForDisplay, VALS.kg, 'Weight (kg)', wtDisabled?'disabled':'');
    if (!wtDisabled) {
      kgWrap.querySelector('.picker-trigger').onclick = function() {
        // Point the standard picker at the LIVE m-wt hidden input
        const liveBlock = document.getElementById(blockId);
        const liveMb = liveBlock?.querySelectorAll('.movement-block')[idx];
        const liveWt = liveMb?.querySelector('.m-wt');
        if (!liveWt) return;
        // Temporarily wire _pickerCallback to handle weight scheme show/hide
        openPickerWithCallback(this, (val) => {
          liveWt.value = val;
          liveWt.dispatchEvent(new Event('input', {bubbles:true}));
          // Update display in picker trigger
          this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, t('builder.weight'));
          // Update movement row subtitle
          const curReps = liveMb.querySelector('.m-reps')?.value || '0';
          const dispKg = val === 999 ? 'Max kg' : (val==0?'BW':val+' kg');
          const phUpd = val > 0 && val !== 999 ? getPerHandNote(liveMb.querySelector('.m-search')?.value||'', val) : '';
          const dispKgFull = dispKg + (phUpd ? ' (' + phUpd + ')' : '');
          row.querySelector('.movement-row-sub').textContent = isT ? dispKgFull : `×${curReps} @ ${dispKgFull}`;
          // Show/hide weight scheme section in the still-open editor
          if (!isT) {
            const editorEl = row.querySelector('.movement-editor-inner');
            let wtWrap = editorEl?.querySelector('.wt-ladder-wrap');
            if (val > 0 && val !== 999 && editorEl) {
              if (!wtWrap) {
                wtWrap = document.createElement('div');
                wtWrap.className = 'wt-ladder-wrap';
                wtWrap.style.cssText = 'margin-top:10px;padding-top:10px;padding-bottom:6px;border-top:1px solid var(--border);';
                // Insert before rep override section if it exists, otherwise append
                const repOverride = editorEl.querySelector('.rep-override-section');
                if (repOverride) editorEl.insertBefore(wtWrap, repOverride);
                else editorEl.appendChild(wtWrap);
              }
              _rebuildWtLadderUI(wtWrap, blockId, idx, liveMb);
            } else if (wtWrap) {
              wtWrap.remove();
            }
          }
        });
      };
    }
    editorInner.appendChild(kgWrap);

    // Suggested weight
    if (!wtDisabled) {
      const suggDiv = document.createElement('div');
      suggDiv.innerHTML = makeSuggestionHTML(name);
      if (suggDiv.firstElementChild) editorInner.appendChild(suggDiv.firstElementChild);
    }

    // ── Weight Ladder section — hidden for BW and unweighted movements ──
    const _curKgMR = parseFloat(mb.querySelector('.m-wt')?.value) || 0;
    if (!wtDisabled && !isT && _curKgMR > 0) {
      const wtLadderWrap = document.createElement('div');
      wtLadderWrap.className = 'wt-ladder-wrap';
      wtLadderWrap.style.cssText = 'margin-top:10px;padding-top:10px;padding-bottom:6px;border-top:1px solid var(--border);';
      _rebuildWtLadderUI(wtLadderWrap, blockId, idx, mb);
      editorInner.appendChild(wtLadderWrap);
    }

    // ── Rep scheme override — after weight scheme ──
    const ovDiv2 = _buildRepOverrideUI(mb, blockId, idx, block);
    if (ovDiv2) editorInner.appendChild(ovDiv2);

    // ── Controlled descent toggle — one-directional movements only ──
    const eccDiv2 = _buildEccentricToggleUI(mb, blockId, idx);
    if (eccDiv2) { eccDiv2.classList.add('ecc-toggle-wrap'); editorInner.appendChild(eccDiv2); }

    row.dataset.mvIdx = idx;
    overview.appendChild(row);
  });

  attachMovementListDrag(overview, blockId);
  panelBody.appendChild(overview);
}

function updateMovOverviewTitle(blockId) {
  const block = document.getElementById(blockId);
  const ovTitle = document.querySelector('#movement-panel-body .mov-overview-title');
  if (ovTitle && block) {
    const c = block.querySelectorAll('.movement-block').length;
    ovTitle.textContent = `${c} ${c!==1 ? t('builder.movements') : t('builder.movement')}`;
  }
}

function removeMov(blockId, idx) {
  const block = document.getElementById(blockId);
  const moves = block.querySelectorAll('.movement-block');
  if (moves[idx]) {
    moves[idx].remove();
    updateBlueprint();
    renderMovementPanel(blockId);
  }
}

function toggleModalityAcc(id) {
  const acc = document.getElementById('modality_acc_' + id);
  if (acc) acc.classList.toggle('open');
}

/* Toggle EMOM penalty enabled state */
function toggleEmomEnabled(id, enabled) {
  const block = document.getElementById(id);
  if (!block) return;
  // Store on the hidden block
  const emomAcc = block.querySelector('.emom-accordion');
  if (enabled) { emomAcc?.classList.add('penalty-on'); }
  else         { emomAcc?.classList.remove('penalty-on'); }
  // Show/hide EMOM result field in hidden block
  block.querySelector('.res-emom-wrap')?.classList.toggle('hidden-el', !enabled);
  // Mirror onto the clone in the detail panel (if open)
  const detailBody = document.getElementById('block-detail-body');
  const cloneAcc = detailBody?.querySelector('.emom-accordion');
  if (cloneAcc) {
    cloneAcc.classList.toggle('penalty-on', enabled);
    const cloneChk = cloneAcc.querySelector('.emom-enabled');
    if (cloneChk) cloneChk.checked = enabled;
  }
  // Also show/hide EMOM result field in the results clone (if detail panel open)
  if (_openBlockId === id && detailBody) {
    detailBody.querySelector('.res-emom-wrap')?.classList.toggle('hidden-el', !enabled);
  }
  updateBlueprint();
  renderBlockOverview(id);
  autoSave();
}

/* Refresh the penalty badge text in the EMOM header */

/* Get penalty-enabled state from hidden block */
function isEmomEnabled(block) {
  return block.querySelector('.emom-accordion')?.classList.contains('penalty-on') || false;
}

/* ── openPickerWithCallback — picker that calls back with chosen val ── */
function openPickerWithCallback(trigger, cb) {
  if (trigger.dataset.disabled === '1') return;
  const inp = trigger.querySelector('input[type="number"]');
  if (!inp || inp.disabled) return;
  _pickerTarget = inp;
  _pickerValues = inp.dataset.pickerValues.split(',').map(Number);
  _pickerCallback = cb;
  const label = trigger.dataset.label;
  const currentVal = parseFloat(inp.value);
  document.getElementById('pickerLabel').textContent = label;
  const drum = document.getElementById('pickerDrum');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  _pickerValues.forEach(v => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v === currentVal ? ' selected' : '');
    item.textContent = formatPickerVal(v, label);
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const idx2 = _pickerValues.indexOf(currentVal);
  drum.scrollTop = (idx2 >= 0 ? idx2 : 0) * 44;
  drum.onscroll = () => { clearTimeout(_pickerScrollTimeout); _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80); };
  trigger.classList.add('open');
  const overlay = document.getElementById('pickerOverlay');
  overlay.classList.add('open');
  overlay._trigger = trigger;
}

/* ── Reset helpers ── */
function resetBlockMovements(id) {
  if (!confirm('Clear all movements in this block?')) return;
  const block = document.getElementById(id);
  if (!block) return;
  block.querySelector('.m-list').innerHTML = '';
  updateBlueprint();
  syncDetailSummary(id);
  autoSave();
  // If movement panel is open, refresh it too
  if (_openMovBlockId === id) renderDetailMovements(id);
}

function resetBlockFull(id) {
  if (!confirm('Reset this block to defaults? All settings and movements will be cleared.')) return;
  const block = document.getElementById(id);
  // Reset modality
  const ms = block.querySelector('.b-mode'); ms.value = 'fortime'; updateBlockUI(ms);
  // Clear movements
  block.querySelector('.m-list').innerHTML = '';
  // Reset all pickers to default via their hidden inputs
  block.querySelectorAll('.picker-trigger input[type="number"]').forEach(inp => {
    const def = parseFloat(inp.defaultValue) || 0;
    inp.value = def;
    const trig = inp.closest('.picker-trigger');
    if (trig) trig.querySelector('.picker-trigger-val').textContent = formatPickerVal(def, trig.dataset.label);
  });
  // Close accordions
  block.querySelectorAll('.accordion-section.open').forEach(a => a.classList.remove('open'));
  updateBlueprint();
  renderDetailBody(id);
}

function deleteCurrentBlock() {
  if (!_openBlockId) return;
  if (!confirm('Delete this block?')) return;
  const block = document.getElementById(_openBlockId);
  if (block) block.remove();
  updateBlockNumbers();
  updateBlueprint();
  closeBlockDetail();
}

function updateBlockNumbers() {
  document.querySelectorAll('.block-num').forEach((el, i) => el.innerText = i + 1);
}

/* ════════════════════════════════════════════════════
   SCROLL PICKER ENGINE
════════════════════════════════════════════════════ */
let _pickerTarget = null;
let _pickerValues = [];
let _pickerScrollTimeout = null;
let _pickerCallback = null; // optional: set by openPickerWithCallback

function makePicker(cls, value, values, label, extraAttrs = '') {
  const display = formatPickerVal(value, label);
  return `<div class="picker-trigger" onclick="openPicker(this)" data-label="${label}" data-disabled="${extraAttrs.includes('disabled') ? '1' : '0'}">
    <span class="picker-trigger-val">${display}</span>
    <span class="picker-trigger-chevron">▼</span>
    <input type="number" class="${cls}" value="${value}" style="display:none" ${extraAttrs} data-picker-values="${values.join(',')}">
  </div>`;
}

function formatPickerVal(v, label) {
  const l = label.toLowerCase();
  if (v === 999 && (l.includes('kg') || l.includes('weight'))) return 'Max kg';
  if (v === 999) return 'Max'; // 999 = Max reps sentinel
  if (l.includes('%') || l.includes('percent') || l.includes('similarity')) return `${v}%`;
  if (l.includes('kg') || l.includes('weight')) return v == 0 ? 'BW' : `${v} kg`;
  if (l.includes('minute') || l.includes('min') || l.includes('duration') || l.includes('cap')) return `${v} min`;
  if (l.includes('second') || l.includes('sec') || l.includes('work') || l.includes('rest') || l.includes('every')) return `${v} s`;
  return `${v}`;
}

function openPicker(trigger) {
  if (trigger.dataset.disabled === '1') return;
  const inp = trigger.querySelector('input[type="number"]');
  if (!inp || inp.disabled) return;
  _pickerTarget = inp;
  _pickerValues = inp.dataset.pickerValues.split(',').map(Number);
  _pickerCallback = null;
  const label = trigger.dataset.label;
  const currentVal = parseFloat(inp.value);
  document.getElementById('pickerLabel').textContent = label;
  const drum = document.getElementById('pickerDrum');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  _pickerValues.forEach(v => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v === currentVal ? ' selected' : '');
    item.textContent = formatPickerVal(v, label);
    item.dataset.val = v;
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const idx = _pickerValues.indexOf(currentVal);
  drum.scrollTop = (idx >= 0 ? idx : 0) * 44;
  drum.onscroll = () => {
    clearTimeout(_pickerScrollTimeout);
    _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80);
  };
  trigger.classList.add('open');
  const overlay = document.getElementById('pickerOverlay');
  overlay.classList.add('open');
  overlay._trigger = trigger;
}

function updateDrumSelection(drum) {
  const idx = Math.round(drum.scrollTop / 44);
  drum.querySelectorAll('.picker-item').forEach((item, i) => {
    item.classList.toggle('selected', i === idx);
  });
}

function pickerDone() {
  const overlay = document.getElementById('pickerOverlay');
  const drum    = document.getElementById('pickerDrum');
  const idx     = Math.round(drum.scrollTop / 44);

  // Custom callback picker (e.g. rest between blocks in results)
  if (overlay._customCallback) {
    const items   = drum.querySelectorAll('.picker-item');
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const chosen  = items[clamped];
    if (chosen) {
      const val = parseInt(chosen.dataset.optval) || 0;
      overlay._customCallback(val);
    }
    overlay._customCallback = null;
    closePicker();
    return;
  }

  // Rest duration picker
  if (overlay._restPicker) {
    const items   = drum.querySelectorAll('.picker-item');
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const chosen  = items[clamped];
    if (chosen) {
      const val   = chosen.dataset.optval;
      const label = chosen.textContent;
      const hiddenEl = document.getElementById('rest-duration-sec');
      const dispEl   = document.getElementById('rest-duration-val');
      if (hiddenEl) hiddenEl.value = val;
      if (dispEl)   dispEl.textContent = label;
      try { localStorage.setItem('wod_rest_duration', val); } catch(e) {}
      // Refresh blueprint, timer overview and analytics rest card
      updateBlueprint();
      updateTimerWodPreview();
      const resContainer = document.getElementById('analytics-results-section');
      if (resContainer) {
        const blocks = document.querySelectorAll('.wod-block');
        if (blocks.length >= 2) buildRestCard(resContainer, [...blocks]);
      }
    }
    overlay._restPicker = false;
    closePicker();
    return;
  }

  // Profile option picker (gender / exp / goal)
  const profField = overlay._profField;
  if (profField && ['gender','exp','goal'].includes(profField)) {
    const items   = drum.querySelectorAll('.picker-item');
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const chosen  = items[clamped];
    if (chosen) {
      const val      = chosen.dataset.optval;
      const label    = chosen.textContent;
      const hiddenEl = document.getElementById(profField === 'exp' ? 'global-exp' : 'global-' + profField);
      const dispEl   = document.getElementById('prof-' + profField + '-val');
      if (hiddenEl) hiddenEl.value = val;
      if (dispEl)   dispEl.textContent = label;
      saveProfile(); saveBodyMetrics(); updateGoalRec(); updateProfileStats(); refreshProfileDisplays(); autoSave();
    }
    overlay._profField = null;
    _profPickerField   = null;
    closePicker();
    return;
  }

  // Profile numeric picker (height / weight / age) — uses _pickerCallback
  if (profField && _pickerCallback) {
    const vals    = _profPickerNumVals;
    const clamped = Math.max(0, Math.min(idx, vals.length - 1));
    _pickerCallback(vals[clamped]);
    _pickerCallback    = null;
    overlay._profField = null;
    _profPickerField   = null;
    closePicker();
    return;
  }

  // Plan training template picker
  if (overlay._planTemplatePicker) {
    const items   = drum.querySelectorAll('.picker-item');
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const chosen  = items[clamped];
    if (chosen) {
      const tplIdx = parseInt(chosen.dataset.tplIdx);
      const templates = overlay._planTemplates || [];
      const tpl = templates[tplIdx];
      if (tpl) {
        _planSelectedTplId = tpl.id;
        _planSelectedTpl   = tpl;
        document.getElementById('plan-tpl-val').textContent = tpl.name;
        const ml = {fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata', exmom:'EXMOM'};
        const bc = tpl.blocks?.length || 0;
        const modes = [...new Set((tpl.blocks||[]).map(b => ml[b.mode]||b.mode))].join(' + ');
        document.getElementById('plan-tpl-desc').textContent = `${bc} block${bc!==1?'s':''} · ${modes}`;
      }
    }
    overlay._planTemplatePicker = false;
    overlay._planTemplates = null;
    closePicker();
    return;
  }

  // Standard picker
  const clamped = Math.max(0, Math.min(idx, _pickerValues.length - 1));
  const val = _pickerValues[clamped];

  if (_pickerCallback) {
    _pickerCallback(val);
    _pickerCallback = null;
    closePicker();
    return;
  }

  if (_pickerTarget) {
    _pickerTarget.value = val;
    const trigger = _pickerTarget.closest('.picker-trigger');
    if (trigger) {
      trigger.querySelector('.picker-trigger-val').textContent =
        formatPickerVal(val, trigger.dataset.label);
    }
    // Mark result time fields as user-set so autoPopulateResultTime won't overwrite
    const cls = _pickerTarget.className || '';
    if (cls.includes('res-m') || cls.includes('res-s')) {
      _pickerTarget.dataset.userSet = '1';
      // Set on both res-m and res-s in all wod-blocks
      document.querySelectorAll('.wod-block').forEach(b => {
        const rm = b.querySelector('.res-m');
        const rs = b.querySelector('.res-s');
        if (rm) rm.dataset.userSet = '1';
        if (rs) rs.dataset.userSet = '1';
      });
    }
    // If a config field changed, re-populate result time (unless user has set it)
    const configFields = ['b-dur','b-int','b-total-int','b-cap','b-tab-r','b-work','b-rest'];
    if (configFields.some(f => cls.includes(f))) {
      const block = _pickerTarget.closest('.wod-block');
      if (block) {
        const rm = block.querySelector('.res-m');
        if (rm?.dataset.userSet !== '1') autoPopulateResultTime(block);
      }
    }
    // If interruptor fields changed, sync clone → original block then update overviews
    const interruptorFields = ['int-reps','int-sec','int-wt','int-key'];
    if (interruptorFields.some(f => cls.includes(f))) {
      const cloneAcc = _pickerTarget.closest('.emom-accordion');
      if (cloneAcc && window._openBlockId) {
        const origBlock = document.getElementById(window._openBlockId);
        const origInput = origBlock?.querySelector('.' + cls.trim().split(' ')[0]);
        if (origInput) origInput.value = val;
      }
      updateBlueprint();
      updateTimerWodPreview();
      if (window._openBlockId) renderBlockOverview(window._openBlockId);
      autoSave();
    }
    _pickerTarget.dispatchEvent(new Event('input', { bubbles: true }));
  }
  closePicker();
}

function closePicker() {
  const overlay = document.getElementById('pickerOverlay');
  overlay.classList.remove('open');
  if (overlay._trigger) {
    overlay._trigger.classList.remove('open');
    overlay._trigger = null;
  }
  _pickerTarget = null;
  _pickerCallback = null;
}

function pickerOverlayClick(e) {
  if (e.target === document.getElementById('pickerOverlay')) closePicker();
}

function setPickerDisabled(trigger, disabled) {
  if (!trigger) return;
  trigger.dataset.disabled = disabled ? '1' : '0';
  trigger.classList.toggle('disabled', disabled);
  const inp = trigger.querySelector('input[type="number"]');
  if (inp) inp.disabled = disabled;
  const dispEl = trigger.querySelector('.picker-trigger-val');
  if (disabled) {
    if (dispEl) dispEl.textContent = 'BW';
  } else {
    // Restore display from current input value
    if (dispEl && inp) dispEl.textContent = formatPickerVal(parseFloat(inp.value)||0, trigger.dataset.label);
  }
}

/* Value arrays */

// ── Dumbbell/Kettlebell per-hand note helper ──
const DB_KB_SINGLE_IMPLEMENT = new Set([
  // Single dumbbell movements (one hand)
  'Dumbbell Power Snatch','Dumbbell Squat Snatch','Dumbbell Hang Power Snatch',
  'Dumbbell Turkish Get-up','Dumbbell Suitcase Deadlift',
  // Single kettlebell movements (one or two hands on same bell)
  'Kettlebell Swing','Kettlebell Swing (Russian)','Kettlebell Swing (American)',
  'Kettlebell Snatch','Kettlebell Power Snatch',
  'Kettlebell Turkish Get-up','Kettlebell Goblet Squat','Kettlebell Deadlift',
  'Kettlebell High Pull',
]);

function getPerHandNote(mvName, kg) {
  if (!kg || kg === 0 || kg === 999) return '';
  const n = mvName.toLowerCase();
  const isDB = n.includes('dumbbell') || n.startsWith('db ');
  const isKB = n.includes('kettlebell') || n.startsWith('kb ');
  if (!isDB && !isKB) return '';
  // Single implement: explicitly named, or in the single-implement set
  if (n.includes('single arm') || n.includes('single-arm') || n.includes('one arm') || n.includes('one-arm')) return '';
  if (DB_KB_SINGLE_IMPLEMENT.has(mvName)) return '';
  const perHand = Math.round(kg / 2 * 10) / 10;
  return `${perHand}kg per hand`;
}

const VALS = {
  reps:     [999, ...[...Array(200)].map((_,i) => i)], // 999 = Max reps sentinel
  rounds:   [...Array(100)].map((_,i) => i),
  goalRnds: [...Array(50)].map((_,i) => i+1),
  oddRnds:  [...Array(25)].map((_,i) => i*2+1),  // 1,3,5,7...49 for pyramid
  kg:       [999, 0, ...Array.from({length:300}, (_,i) => i+1)], // 999 = Max weight sentinel
  minCap:   [...Array(120)].map((_,i) => i+1),
  minDur:   [...Array(120)].map((_,i) => i+1),
  sec:      [5,10,15,20,25,30,35,40,45,50,55,60,75,90,120,150,180,240,300,360,420,480,600],
  totalInt: [...Array(60)].map((_,i) => i+1),
  intLen:   [15,20,25,30,45,60,75,90,120,150,180,240,300],
  tabRnds:  [...Array(30)].map((_,i) => i+1),
  finMin:   [...Array(121)].map((_,i) => i),
  finSec:   [...Array(60)].map((_,i) => i),
};

/* ════════════════════════════════════════════════════
   BLOCK / ACCORDION / MOVEMENT HELPERS
════════════════════════════════════════════════════ */
function toggleAccordion(accId, bodyId) {
  const acc = document.getElementById(accId);
  if (!acc) return;
  const isOpen = acc.classList.toggle('open');
  if (accId.startsWith('emom_acc_')) {
    const blockId = accId.replace('emom_acc_', '');
    const block = document.getElementById(blockId);
    if (block) block.querySelector('.res-emom-wrap')?.classList.toggle('hidden-el', !isOpen);
  }
  updateBlueprint();
}

function updateBlockUI(sel) {
  // The select may be in the hidden block OR in the detail panel clone.
  // Always apply to the hidden block so the source-of-truth is correct.
  const b = sel.closest('.wod-block') ||
            (_openBlockId ? document.getElementById(_openBlockId) : null);
  if (!b) return;
  // Clear user-set flag on mode change so auto-populate refreshes
  const rm = b.querySelector('.res-m');
  const rs = b.querySelector('.res-s');
  if (rm) rm.dataset.userSet = '0';
  if (rs) rs.dataset.userSet = '0';
  b.querySelectorAll('.b-cfg').forEach(e => e.classList.add('hidden-el'));
  const c = b.querySelector('.b-cfg-' + sel.value); if (c) c.classList.remove('hidden-el');
  const mode = sel.value;
  const isTabata  = mode === 'tabata';
  const isExmom   = mode === 'exmom';
  const isForTime = mode === 'fortime';
  // Reset ladder to fixed when switching to AMRAP or EXMOM
  if (mode === 'amrap' || mode === 'exmom') {
    b.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = 'fixed');
    b.querySelectorAll('.ladder-fields').forEach(f => f.style.display = 'none');
    b.querySelectorAll('.ladder-type-btn').forEach(btn => {
      const active = btn.dataset.type === 'fixed';
      btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
      btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
      btn.style.color       = active ? 'white'        : 'var(--text)';
    });
    b.querySelectorAll('.ladder-preview').forEach(el => el.textContent = '');
  }
  // Movement reps fields hidden for tabata
  b.querySelectorAll('.m-reps-box').forEach(box => box.classList.toggle('hidden-el', isTabata));
  // Results: Final Time always shown — pre-fill from duration for fixed-time modes
  b.querySelector('.res-time-wrap')?.classList.remove('hidden-el');
  // Pre-fill time pickers if not already set
  const prefillTime = (wrap) => {
    if (!wrap) return;
    const mPicker = wrap.querySelector('.picker-trigger[data-label="Final Time — Minutes"]');
    const sPicker = wrap.querySelector('.picker-trigger[data-label="Final Time — Seconds"]');
    let prefillMin = null, prefillSec = '00';
    if (mode === 'amrap') {
      prefillMin = parseInt(b.querySelector('.b-dur')?.value) || null;
    } else if (mode === 'emom' || mode === 'exmom') {
      const emomTotalSec = (parseInt(b.querySelector('.b-total-int')?.value)||0) * (parseInt(b.querySelector('.b-int')?.value)||60);
      if (emomTotalSec > 0) { prefillMin = Math.floor(emomTotalSec/60); prefillSec = String(emomTotalSec%60).padStart(2,'0'); }
    } else if (mode === 'tabata') {
      const tabataTotalSec = (parseInt(b.querySelector('.b-tab-r')?.value)||8) * 30;
      prefillMin = Math.floor(tabataTotalSec/60); prefillSec = String(tabataTotalSec%60).padStart(2,'0');
    } else if (mode === 'fortime') {
      prefillMin = parseInt(b.querySelector('.b-cap')?.value) || null;
    }
    if (prefillMin !== null && mPicker) {
      mPicker.querySelector('.picker-trigger-val').textContent = prefillMin;
      sPicker?.querySelector && (sPicker.querySelector('.picker-trigger-val').textContent = prefillSec);
      wrap.querySelectorAll('input[type="hidden"]').forEach((inp, i) => {
        if (i === 0) inp.value = prefillMin;
        if (i === 1) inp.value = prefillSec === '00' ? 0 : parseInt(prefillSec);
      });
      // Also sync hidden wod-block res-m/res-s
      b.querySelector('.res-m') && (b.querySelector('.res-m').value = prefillMin);
      b.querySelector('.res-s') && (b.querySelector('.res-s').value = prefillSec === '00' ? 0 : parseInt(prefillSec));
      // Also sync analytics results card if visible
      autoPopulateResultTime(b);
    }
  };
  prefillTime(b.querySelector('.res-time-wrap'));
  if (_openBlockId && b.id === _openBlockId) {
    const detailBody = document.getElementById('block-detail-body');
    if (detailBody) prefillTime(detailBody.querySelector('.res-time-wrap'));
  }
  // Results: Rounds Done hidden for Tabata; label changes for EMOM/EXMOM
  b.querySelector('.res-wrap-r')?.classList.toggle('hidden-el', isTabata);
  const rl = b.querySelector('.res-wrap-r label');
  if (rl) rl.innerText = (mode === 'emom' || mode === 'exmom') ? t('result.intervals.done') : t('result.rounds.done');
  // Results: Extra Reps label
  const xl = b.querySelector('.x-label');
  if (xl) xl.innerText = isTabata ? t('builder.total.reps') : t('builder.extra.reps');
  // Also apply visibility to the results clone in the detail panel (if open)
  if (_openBlockId && b.id === _openBlockId) {
    const detailBody = document.getElementById('block-detail-body');
    if (detailBody) {
      detailBody.querySelector('.res-time-wrap')?.classList.remove('hidden-el');
      detailBody.querySelector('.res-wrap-r')?.classList.toggle('hidden-el', isTabata);
      const dlrl = detailBody.querySelector('.res-wrap-r label');
      if (dlrl) dlrl.innerText = (mode === 'emom' || mode === 'exmom') ? t('result.intervals.done') : t('result.rounds.done');
      detailBody.querySelectorAll('.m-reps-box').forEach(box => box.classList.toggle('hidden-el', isTabata));
      const dxl = detailBody.querySelector('.x-label');
      if (dxl) dxl.innerText = isTabata ? t('builder.total.reps') : t('builder.extra.reps');
    }
  }
}

function applyClassicWOD(id, wodName, descriptionOnly = false) {
  const block = document.getElementById(id);
  if (!block) return;
  // Empty selection — clear description, movements, and close accordion
  if (!wodName) {
    const desc = block.querySelector(`[id="cwod_desc_${id}"]`);
    if (desc) desc.innerHTML = '';
    block.querySelector('.m-list').innerHTML = '';
    block.querySelector('.classic-accordion')?.classList.remove('open');
    // Reset mode to fortime default
    const modeEl = block.querySelector('.b-mode');
    if (modeEl) { modeEl.value = 'fortime'; updateBlockUI(modeEl); }
    // Reset ladder to fixed
    block.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = 'fixed');
    block.querySelectorAll('.ladder-fields').forEach(f => f.style.display = 'none');
    block.querySelectorAll('.ladder-type-btn').forEach(btn => {
      const active = btn.dataset.type === 'fixed';
      btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
      btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
      btn.style.color       = active ? 'white'        : 'var(--text)';
    });
    block.querySelectorAll('.ladder-preview').forEach(el => el.textContent = '');
    updateBlueprint(); autoSave();
    renderBlockList();
    // Rebuild the detail panel so the dropdown, desc and movements all reflect empty state
    if (_openBlockId === id) setTimeout(() => renderDetailBody(id), 0);
    return;
  }
  const gender = document.getElementById('global-gender').value;
  const wod = CLASSIC_WODS[wodName]; if (!wod) return;
  const cwodAcc = document.getElementById(`cwod_acc_${id}`);
  if (cwodAcc) cwodAcc.classList.add('open');
  const ms = block.querySelector('.b-mode'); ms.value = wod.mode; updateBlockUI(ms);
  if (wod.mode === 'fortime') {
    if (wod.cap)    { block.querySelector('.b-cap').value = wod.cap; }
    if (wod.rounds) { block.querySelector('.b-target').value = wod.rounds; }
    // Apply ladder config if WOD has it
    if (wod.ladder) {
      block.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = wod.ladder.type);
      const startInp = block.querySelector('.b-ladder-start');
      const incInp   = block.querySelector('.b-ladder-inc');
      if (startInp) startInp.value = wod.ladder.start;
      if (incInp)   incInp.value   = wod.ladder.inc;
      // Show ladder fields
      block.querySelectorAll('.ladder-fields').forEach(f => f.style.display = '');
      // Update button styles
      block.querySelectorAll('.ladder-type-btn').forEach(btn => {
        const active = btn.dataset.type === wod.ladder.type;
        btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
        btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
        btn.style.color       = active ? 'white'        : 'var(--text)';
      });
      updateLadderPreview(id);
    } else {
      // Reset to fixed if no ladder
      block.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = 'fixed');
      block.querySelectorAll('.ladder-fields').forEach(f => f.style.display = 'none');
      block.querySelectorAll('.ladder-type-btn').forEach(btn => {
        const active = btn.dataset.type === 'fixed';
        btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
        btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
        btn.style.color       = active ? 'white'        : 'var(--text)';
      });
    }
  } else if (wod.mode === 'amrap') {
    block.querySelector('.b-dur').value = wod.duration;
    setLadderType(id, 'fixed');
  } else if (wod.mode === 'emom') {
    block.querySelector('.b-int').value = wod.interval;
    block.querySelector('.b-total-int').value = wod.totalIntervals;
    setLadderType(id, 'fixed');
  } else if (wod.mode === 'tabata') {
    setLadderType(id, 'fixed');
  }
  // Now auto-populate result time from the newly set config
  autoPopulateResultTime(block);
  if (!descriptionOnly) {
    block.querySelector('.m-list').innerHTML = '';
    const isFemale = (gender === 'female');
    wod.movements(isFemale).forEach(mv => {
      const isT = (wod.mode === 'tabata');
      const d = document.createElement('div'); d.className = 'movement-block';
      const disabledAttr = (mv.kg === 0 && mv.kg !== 999) ? 'disabled' : '';
      d.innerHTML = `
        <input type="text" class="m-search" value="${mv.name}" style="display:none">
        <input type="hidden" value="${mv.name}">
        <input type="number" class="m-reps" value="${mv.reps || 0}" style="display:none">
        <input type="hidden" class="m-wt-ladder-type" value="fixed">
        <input type="number" class="m-wt-ladder-inc" value="5" style="display:none">
        <input type="hidden" class="m-controlled-descent" value="1">
        <input type="hidden" class="m-reps-override" value="${mv.repsOverride||0}">
        <input type="hidden" class="m-reps-scheme" value="${mv.repsScheme||'fixed'}">
        <input type="hidden" class="m-reps-inc" value="${mv.repsInc||5}">
        ${makePicker('m-wt', mv.kg || 0, VALS.kg, 'Weight (kg)', disabledAttr)}`;
      block.querySelector('.m-list').appendChild(d);
    });
    // Apply ladder scheme from CWOD definition if present
    if (wod.ladderType && wod.ladderType !== 'fixed') {
      const ladderTypeInp = block.querySelector('.b-ladder-type');
      if (ladderTypeInp) { ladderTypeInp.value = wod.ladderType; setLadderType(id, wod.ladderType); }
      if (wod.ladderStart) { const si = block.querySelector('.b-ladder-start'); if (si) si.value = wod.ladderStart; }
      if (wod.ladderInc)   { const ii = block.querySelector('.b-ladder-inc');   if (ii) ii.value = wod.ladderInc; }
    }
  }
  // Build full WOD setup display and write to hidden block's desc element
  const desc = block.querySelector(`[id="cwod_desc_${id}"]`);
  if (desc && wod.description) {
    const modeLabel = { fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata' }[wod.mode] || wod.mode;
    desc.innerHTML = `
      <div style="color:var(--accent);font-weight:800;margin-bottom:4px;">${wodName} — ${modeLabel}</div>
      <div style="color:var(--label);font-style:italic;font-size:.7rem;">${wod.description}</div>`;
  } else if (desc) {
    desc.innerHTML = '';
  }
  // Also sync to the clone in the detail panel if open
  if (_openBlockId === id) {
    const cloneDesc = document.getElementById('block-detail-body')?.querySelector('[id^="cwod_desc_"]');
    if (cloneDesc && desc) cloneDesc.innerHTML = desc.innerHTML;
  }

  // Update picker display labels for config values in the hidden block
  const setPicker = (cls, val) => {
    const inp = block.querySelector('.' + cls);
    if (!inp) return;
    inp.value = val;
    const trig = inp.closest('.picker-trigger');
    if (trig) trig.querySelector('.picker-trigger-val').textContent = formatPickerVal(parseFloat(val)||0, trig.dataset.label);
  };
  if (wod.mode === 'fortime') { setPicker('b-cap', wod.cap||15); setPicker('b-target', wod.rounds||1); }
  else if (wod.mode === 'amrap') { setPicker('b-dur', wod.duration||20); }
  else if (wod.mode === 'emom') { setPicker('b-int', wod.interval||60); setPicker('b-total-int', wod.totalIntervals||15); }

  // Store maxReps flag and movement list on block for Results accordion
  // maxReps now handled via reps:999 on individual movements
  if (wod.maxReps) {
    const mvNames = wod.movements(false).map(mv => mv.name);
    const zeros = mvNames.map(() => 0);
    const mvDataInp = block.querySelector('.res-mv-data');
    if (mvDataInp) mvDataInp.value = JSON.stringify({ names: mvNames, reps: zeros });
  } else {
    const mvDataInp = block.querySelector('.res-mv-data');
    if (mvDataInp) mvDataInp.value = '';
  }

  if (!descriptionOnly) {
    updateBlueprint();
    autoSave();
    // If this block's detail panel is open, re-render everything so modality accordion
    // header label, config pickers and movement list all reflect the selected WOD
    if (_openBlockId === id) {
      renderDetailBody(id);
    }
  }
}

function overrideScrollableParents(input) {
  if (input._overriddenParents) return;
  input._overriddenParents = [];
  let el = input.parentElement;
  while (el && el !== document.body) {
    // Skip the movement panel — it must keep overflow-y:auto to scroll.
    // The autocomplete dropdown is position:fixed so it doesn't need this.
    if (el.id === 'movement-panel') { el = el.parentElement; continue; }
    const style = window.getComputedStyle(el);
    if (style.overflow === 'auto' || style.overflow === 'hidden' ||
        style.overflowY === 'auto' || style.overflowY === 'hidden') {
      input._overriddenParents.push({el, overflow: el.style.overflow, overflowY: el.style.overflowY});
      el.style.overflow = 'visible';
      el.style.overflowY = 'visible';
    }
    el = el.parentElement;
  }
}

function restoreScrollableParents(input) {
  if (!input._overriddenParents) return;
  input._overriddenParents.forEach(({el, overflow, overflowY}) => {
    el.style.overflow = overflow;
    el.style.overflowY = overflowY;
  });
  input._overriddenParents = null;
}

function wireSearchFocus(input) {
  if (input._focusWired) return;
  input._focusWired = true;
  // Close all other open accordions in the same block-detail-panel
  const panel = input.closest('#block-detail-panel');
  if (panel) {
    panel.querySelectorAll('.accordion-section.open').forEach(acc => {
      if (!acc.contains(input)) acc.classList.remove('open');
    });
  }
  // After layout shift settles, reposition dropdown if open
  setTimeout(() => {
    if (input._resultsEl && input._resultsEl.style.display !== 'none') repositionSearchDropdown(input);
  }, 50);
}

function handleSearch(input) {
  // Ensure focus wiring is set up (catches cases where onfocus didn't fire first)
  if (!input._focusWired) wireSearchFocus(input);

  const q = input.value.toLowerCase();
  // Cache resultsEl and search-wrap
  if (!input._resultsEl) {
    input._resultsEl = input.parentElement?.querySelector('.search-results')
      || input.closest('.search-container')?.querySelector('.search-results');
  }

  const resultsEl = input._resultsEl;
  if (!resultsEl) return;

  resultsEl.innerHTML = '';
  if (!q) {
    resultsEl.style.display = 'none';
      if (input._scrollRepos) { document.removeEventListener('scroll', input._scrollRepos, true); input._scrollRepos = null; }
      if (resultsEl._movRow) { resultsEl._movRow.classList.remove('search-open'); resultsEl._movRow = null; }
      if (resultsEl._origParent && resultsEl.parentElement === document.body) resultsEl._origParent.appendChild(resultsEl);
    restoreScrollableParents(input);
    return;
  }

  // Move to body to fully escape overflow/clip containers
  if (resultsEl.parentElement !== document.body) {
    resultsEl._origParent = resultsEl.parentElement;
    document.body.appendChild(resultsEl);
  }

  // Override overflow on all scrollable parents so absolute dropdown isn't clipped
  overrideScrollableParents(input);

  // Position fixed dropdown precisely under input
  const rect = input.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 4;
  const spaceAbove = rect.top - 4;
  resultsEl.style.width = rect.width + 'px';
  resultsEl.style.left = rect.left + 'px';
  if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
    resultsEl.style.top = (rect.bottom + 4) + 'px';
    resultsEl.style.bottom = '';
    resultsEl.style.maxHeight = Math.max(80, Math.min(spaceBelow, 260)) + 'px';
  } else {
    resultsEl.style.top = '';
    resultsEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    resultsEl.style.maxHeight = Math.max(80, Math.min(spaceAbove, 260)) + 'px';
  }
  Object.keys(MASTER_DB).filter(k => k.toLowerCase().includes(q)).forEach(m => {
    const d = document.createElement('div'); d.className = 'search-item'; d.innerText = m;
    d.onmousedown = (e) => {
      // Use mousedown instead of click so it fires before the input loses focus
      e.preventDefault();
      input.value = m;
      resultsEl.style.display = 'none';
      if (input._scrollRepos) { document.removeEventListener('scroll', input._scrollRepos, true); input._scrollRepos = null; }
      if (resultsEl._movRow) { resultsEl._movRow.classList.remove('search-open'); resultsEl._movRow = null; }
      if (resultsEl._origParent && resultsEl.parentElement === document.body) resultsEl._origParent.appendChild(resultsEl);
      restoreScrollableParents(input);

      // Update the hidden name input in the same search-container
      const hiddenInp = input.parentElement?.querySelector('input[type="hidden"]');
      if (hiddenInp) hiddenInp.value = m;

      // Find the source-of-truth movement-block in the hidden timeline
      const mb = input.closest('.movement-block') ||
        (() => {
          const row = input.closest('.movement-row');
          if (!row) return null;
          // Movement panel (level 3)
          if (_openMovBlockId) {
            const block = document.getElementById(_openMovBlockId);
            const allRows = [...document.querySelectorAll('#movement-panel-body .movement-row')];
            const idx = allRows.indexOf(row);
            return block?.querySelectorAll('.movement-block')?.[idx] || null;
          }
          // Block detail panel (level 2)
          if (_openBlockId) {
            const block = document.getElementById(_openBlockId);
            const listEl = document.getElementById('detail-movlist-' + _openBlockId);
            const allRows = listEl ? [...listEl.querySelectorAll('.movement-row')] : [];
            const idx = allRows.indexOf(row);
            return block?.querySelectorAll('.movement-block')?.[idx] || null;
          }
          return null;
        })();

      if (mb) {
        // Update both the m-search AND the hidden key input in the real block
        const mbSearch = mb.querySelector('.m-search');
        if (mbSearch) mbSearch.value = m;
        const mbHidden = mb.querySelector('input[type="hidden"]');
        if (mbHidden) mbHidden.value = m;

        // Controlled-descent toggle only exists for oneDir:true movements —
        // selecting a movement via search updates the row in place rather
        // than a full re-render, so the toggle needs its own targeted
        // insert/remove here or it never appears/disappears on selection.
        const eccRow = input.closest('.movement-row');
        if (eccRow) {
          const editorInnerEcc = eccRow.querySelector('.movement-editor-inner');
          const existingEcc = editorInnerEcc?.querySelector('.ecc-toggle-wrap');
          if (existingEcc) existingEcc.remove();
          if (editorInnerEcc) {
            const eccBlockId = _openMovBlockId || _openBlockId;
            const eccIdx = parseInt(eccRow.dataset.mvIdx);
            const newEccDiv = _buildEccentricToggleUI(mb, eccBlockId, eccIdx);
            if (newEccDiv) { newEccDiv.classList.add('ecc-toggle-wrap'); editorInnerEcc.appendChild(newEccDiv); }
          }
        }

        // Handle bodyweight toggle
        const wt = mb.querySelector('.m-wt');
        if (MASTER_DB[m]?.type === 'bw' && wt) {
          wt.value = 0;
          const trigger = wt.closest('.picker-trigger');
          if (trigger) setPickerDisabled(trigger, true);
          // Reset weight ladder to fixed for BW movements
          const wtLadInp = mb.querySelector('.m-wt-ladder-type');
          if (wtLadInp) wtLadInp.value = 'fixed';
          // Hide weight scheme section
          const row = input.closest('.movement-row');
          const wtWrap = row?.querySelector('.wt-ladder-wrap');
          if (wtWrap) wtWrap.style.display = 'none';
          const detailKgTrigger = row?.querySelector('.picker-trigger[data-label="Weight (kg)"]');
          if (detailKgTrigger) setPickerDisabled(detailKgTrigger, true);
        } else if (wt) {
          const trigger = wt.closest('.picker-trigger');
          if (trigger) setPickerDisabled(trigger, false);
          // Show weight scheme section
          const row = input.closest('.movement-row');
          const wtWrap = row?.querySelector('.wt-ladder-wrap');
          if (wtWrap) wtWrap.style.display = '';
          const detailKgTrigger = row?.querySelector('.picker-trigger[data-label="Weight (kg)"]');
          if (detailKgTrigger) setPickerDisabled(detailKgTrigger, false);
        }
        // Update per-hand note label when movement changes
        const row2 = input.closest('.movement-row');
        if (row2) {
          // Read the DISPLAYED weight from the picker trigger val — not the raw input
          // because the display may show BW while raw input still holds old value
          const kgTrigger = row2.querySelector('.picker-trigger[data-label="Weight (kg)"]');
          const dispVal = kgTrigger?.querySelector('.picker-trigger-val')?.textContent?.trim() || '';
          const isNowBW = MASTER_DB[m]?.type === 'bw' || dispVal === 'BW' || dispVal === '';
          const wtInp = mb?.querySelector('.m-wt');
          const curKg = isNowBW ? 0 : (parseFloat(wtInp?.value) || 0);
          const phNew = curKg > 0 && curKg !== 999 ? getPerHandNote(m, curKg) : '';
          const kgWrap2 = row2.querySelector('label[for], .field-stack label');
          // Find the Weight label in the editor
          row2.querySelectorAll('.field-stack label').forEach(lbl => {
            if (lbl.textContent.startsWith('Weight')) {
              lbl.innerHTML = `Weight (kg)${phNew ? ' <span style="font-size:.65rem;color:var(--label);">(' + phNew + ')</span>' : ''}`;
            }
          });
          // Update sub-label
          const subEl = row2.querySelector('.movement-row-sub');
          if (subEl) {
            const curKgStr = curKg === 999 ? 'Max kg' : (curKg === 0 ? 'BW' : curKg + ' kg');
            const curRepsVal = mb?.querySelector('.m-reps')?.value || '0';
            const isTabata = mb?.closest('.wod-block')?.querySelector('.b-mode')?.value === 'tabata';
            const dispFull = curKgStr + (phNew ? ' (' + phNew + ')' : '');
            subEl.textContent = isTabata ? dispFull : `×${curRepsVal} @ ${dispFull}`;
          }
        }
      }

      // EMOM interruptor: update hidden block AND sync clone in detail panel
      const emomContainer = input.closest('.emom-accordion, [id^="emom_body"]');
      if (emomContainer) {
        const blockEl = emomContainer.closest('.wod-block') ||
          (_openBlockId ? document.getElementById(_openBlockId) : null);
        if (blockEl) {
          // Update both key AND search text on the hidden block (overviews read .m-search)
          const intKeyEl = blockEl.querySelector('.int-key');
          if (intKeyEl) intKeyEl.value = m;
          const intSearchEl = blockEl.querySelector('.emom-accordion .m-search');
          if (intSearchEl) intSearchEl.value = m;

          // BW handling on hidden block
          const isBW = MASTER_DB[m]?.type === 'bw';
          const intWtInp = blockEl.querySelector('.int-wt');
          if (intWtInp) {
            if (isBW) intWtInp.value = 0;
            const intWtTrig = intWtInp.closest('.picker-trigger');
            if (intWtTrig) setPickerDisabled(intWtTrig, isBW);
          }

          // Sync the cloned weight picker in the detail panel (if open)
          const detailBody = document.getElementById('block-detail-body');
          if (detailBody) {
            const cloneEmomBody = detailBody.querySelector('[id^="emom_body_"]');
            if (cloneEmomBody) {
              const cloneWtTrig = cloneEmomBody.querySelector('.picker-trigger[data-label="Weight (kg)"]');
              if (cloneWtTrig) {
                setPickerDisabled(cloneWtTrig, isBW);
                if (isBW) {
                  cloneWtTrig.querySelector('.picker-trigger-val').textContent = 'BW';
                  const cloneWtInp = cloneWtTrig.querySelector('input[type="number"]');
                  if (cloneWtInp) cloneWtInp.value = 0;
                }
              }
            }
          }
        }
        autoSave();
        updateBlueprint();
        if (_openBlockId) {
          renderBlockOverview(_openBlockId);
        }
      }
      // Update the row name label in-place
      const row = input.closest('.movement-row');
      if (row) {
        const nameEl = row.querySelector('.movement-row-name');
        if (nameEl) nameEl.textContent = m;
        // Update suggested weight for new movement
        const suggEl = row.querySelector('.movement-suggestion, [style*="rgba(59,130,246"]');
        const editorInner = row.querySelector('.movement-editor-inner');
        if (editorInner) {
          // Remove old suggestion if any
          const oldSugg = editorInner.querySelector('[style*="rgba(59,130,246"]');
          if (oldSugg) oldSugg.remove();
          // Add new suggestion
          const p = MASTER_DB[m];
          const wtDisabled = !p || p.type === 'bw';
          if (!wtDisabled) {
            const suggDiv = document.createElement('div');
            suggDiv.innerHTML = makeSuggestionHTML(m);
            if (suggDiv.firstElementChild) editorInner.appendChild(suggDiv.firstElementChild);
          }
        }
      }
      // Update overview title count if in movement panel
      if (_openMovBlockId) updateMovOverviewTitle(_openMovBlockId);

      updateBlueprint();
    };
    resultsEl.appendChild(d);
  });

  // No built-in results — show create custom movement option
  if (!resultsEl.children.length) {
    const dc = document.createElement('div');
    dc.className = 'search-item search-item-create';
    dc.innerHTML = '<span style="font-size:1.1rem;line-height:1;">＋</span> Create "' + input.value.trim() + '" as custom movement';
    dc.onmousedown = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      resultsEl.style.display = 'none';
      if (input._scrollRepos) { document.removeEventListener('scroll', input._scrollRepos, true); input._scrollRepos = null; }
      if (resultsEl._movRow) { resultsEl._movRow.classList.remove('search-open'); resultsEl._movRow = null; }
      if (resultsEl._origParent && resultsEl.parentElement === document.body) resultsEl._origParent.appendChild(resultsEl);
      restoreScrollableParents(input);
      openCustomMovModal();
      setTimeout(() => {
        const nameEl = document.getElementById('cmov-name');
        if (nameEl) nameEl.value = name;
      }, 100);
    };
    resultsEl.appendChild(dc);
  }

  resultsEl.style.display = 'block';
  // Track which movement row owns this dropdown
  const movRow = input.closest('.movement-row');
  if (movRow) movRow.classList.add('search-open');
  resultsEl._movRow = movRow || null;

  // Reposition on scroll
  if (!input._scrollRepos) {
    input._scrollRepos = () => {
      if (resultsEl.style.display === 'none') return;
      const r = input.getBoundingClientRect();
      resultsEl.style.left = r.left + 'px';
      resultsEl.style.width = r.width + 'px';
      resultsEl.style.top = (r.bottom + 1) + 'px';
    };
    document.addEventListener('scroll', input._scrollRepos, true);
  }
}

function repositionSearchDropdown(input) {
  const resultsEl = input._resultsEl;
  if (!resultsEl || resultsEl.style.display === 'none') return;
  const rect = input.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  resultsEl.style.left = rect.left + 'px';
  resultsEl.style.width = rect.width + 'px';
  if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
    resultsEl.style.top = rect.bottom + 'px';
    resultsEl.style.bottom = '';
    resultsEl.style.maxHeight = Math.max(80, spaceBelow) + 'px';
  } else {
    resultsEl.style.top = '';
    resultsEl.style.bottom = (window.innerHeight - rect.top) + 'px';
    resultsEl.style.maxHeight = Math.max(80, spaceAbove) + 'px';
  }
}

function addManualRow(bid) {
  const block = document.getElementById(bid);
  if (!block) return;
  const isT = (block.querySelector('.b-mode').value === 'tabata');
  const l = block.querySelector('.m-list');
  const d = document.createElement('div'); d.className = 'movement-block';
  d.innerHTML = `
    <input type="text" class="m-search" value="" style="display:none" placeholder="Search movement…" data-i18n-placeholder="search.movement">
    <input type="hidden" value="">
    <input type="number" class="m-reps" value="10" style="display:none">
    <input type="hidden" class="m-wt-ladder-type" value="fixed">
    <input type="number" class="m-wt-ladder-inc" value="5" style="display:none">
    <input type="hidden" class="m-controlled-descent" value="1">
    <input type="hidden" class="m-reps-override" value="0">
    <input type="hidden" class="m-reps-scheme" value="fixed">
    <input type="hidden" class="m-reps-inc" value="5">
    ${makePicker('m-wt', 0, VALS.kg, 'Weight (kg)')}`;
  // Auto-open the movement editor in the detail panel
  l.appendChild(d);
  updateBlueprint();
}

/* ════════════════════════════════════════════════════
   WORKOUT STATE PERSISTENCE
   Saves full builder state (blocks + their data) to
   localStorage so it survives page close/refresh.
════════════════════════════════════════════════════ */
const WOD_STATE_KEY = 'wod_architect_state_v8'; // v6: clean initial state

function saveWorkoutState() {
  const blocks = document.querySelectorAll('.wod-block');
  const state = [];
  blocks.forEach(b => {
    // Skip empty blocks (no movements, no classic WOD, no EMOM key) — don’t persist them
    const movBlocks = b.querySelectorAll(".movement-block");
    const hasMovements = movBlocks.length > 0
      && [...movBlocks].some(mb => mb.querySelector("input[type=\"hidden\"]")?.value);
    const hasCwod = b.querySelector('.cwod-select')?.value;
    const hasEmom = b.querySelector('.int-key')?.value;
    if (!hasMovements && !hasCwod && !hasEmom) return;
    const blockData = {
      id: b.id,
      mode: b.querySelector('.b-mode')?.value || 'fortime',
      emomOpen: b.querySelector('.emom-accordion')?.classList.contains('open') || false,
      cwodOpen: b.querySelector('.classic-accordion')?.classList.contains('open') || false,
      cwod: b.querySelector('.cwod-select')?.value || '',
      // Config picker values
      cap: b.querySelector('.b-cap')?.value || '15',
      target: b.querySelector('.b-target')?.value || '5',
      dur: b.querySelector('.b-dur')?.value || '10',
      int: b.querySelector('.b-int')?.value || '60',
      totalInt: b.querySelector('.b-total-int')?.value || '15',
      work: b.querySelector('.b-work')?.value || '20',
      rest: b.querySelector('.b-rest')?.value || '10',
      tabR: b.querySelector('.b-tab-r')?.value || '8',
      // EMOM interruptor
      intKey: b.querySelector('.int-key')?.value || '',
      intSearch: b.querySelector('.emom-accordion .m-search')?.value || '',
      intReps: b.querySelector('.int-reps')?.value || '5',
      intWt: b.querySelector('.int-wt')?.value || '0',
      intSec: b.querySelector('.int-sec')?.value || '60',
      emomPenaltyEnabled: b.querySelector('.emom-accordion')?.classList.contains('penalty-on') || false,
      // Ladder config
      ladderType:  b.querySelector('.b-ladder-type')?.value  || 'fixed',
      ladderStart: b.querySelector('.b-ladder-start')?.value || '5',
      ladderInc:   b.querySelector('.b-ladder-inc')?.value   || '5',
      // Result values
      resR: b.querySelector('.res-r')?.value || '0',
      resX: b.querySelector('.res-x')?.value || '0',
      resM: b.querySelector('.res-m')?.value || '0',
      resS: b.querySelector('.res-s')?.value || '0',
      resEmom: b.querySelector('.res-emom')?.value || '0',
      resMvData: b.querySelector('.res-mv-data')?.value || '',
      maxReps: b.dataset.maxReps || '0',
      // Movements
      movements: []
    };
    b.querySelectorAll('.movement-block').forEach(mb => {
      const name = mb.querySelector('input[type="hidden"]')?.value || '';
      blockData.movements.push({
        name,
        reps: mb.querySelector('.m-reps')?.value || '0',
        kg:   mb.querySelector('.m-wt')?.value || '0',
        bwLocked: mb.querySelector('.m-wt')?.disabled || false,
        wtLadderType:  mb.querySelector('.m-wt-ladder-type')?.value  || 'fixed',
        wtLadderInc:   mb.querySelector('.m-wt-ladder-inc')?.value   || '5',
        controlledDescent: mb.querySelector('.m-controlled-descent')?.value !== '0'
      });
    });
    // Profile inputs
    blockData.globalH = document.getElementById('global-h')?.value || '175';
    blockData.globalW = document.getElementById('global-w')?.value || '75';
    blockData.globalGender = document.getElementById('global-gender')?.value || 'male';
    blockData.globalVo2max = document.getElementById('global-vo2max')?.value || '0';
    blockData.globalHrmax  = document.getElementById('global-hrmax')?.value  || '0';
    blockData.globalHrrest = document.getElementById('global-hrrest')?.value || '0';
    state.push(blockData);
  });
  try { localStorage.setItem(WOD_STATE_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreWorkoutState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(WOD_STATE_KEY)); } catch(e) {}

  // Restore rest duration from localStorage
  try {
    const savedRest = localStorage.getItem('wod_rest_duration');
    if (savedRest !== null && savedRest !== undefined) {
      const el = document.getElementById('rest-duration-sec');
      const disp = document.getElementById('rest-duration-val');
      if (el) el.value = savedRest;
      if (disp) {
        const labels = {'0':t('timer.no.rest.label'), '10':'10 sec', '20':'20 sec', '30':'30 sec', '40':'40 sec', '50':'50 sec', '60':'1 min', '75':'1:15 min', '90':'1:30 min', '105':'1:45 min', '120':'2 min', '150':'2:30 min', '180':'3 min', '210':'3:30 min', '240':'4 min', '270':'4:30 min', '300':'5 min', '360':'6 min', '420':'7 min', '480':'8 min', '540':'9 min', '600':'10 min'};
        disp.textContent = labels[savedRest] || (savedRest + 's');
      }
    }
  } catch(e) {}

  if (!state || !state.length) return false;

  // Restore profile values from first block's stored values
  const first = state[0];
  if (first.globalH) document.getElementById('global-h').value = first.globalH;
  if (first.globalW) document.getElementById('global-w').value = first.globalW;
  if (first.globalGender) document.getElementById('global-gender').value = first.globalGender;
  if (first.globalVo2max && first.globalVo2max !== '0') {
    document.getElementById('global-vo2max').value = first.globalVo2max;
    document.getElementById('prof-vo2max-val').textContent = first.globalVo2max + ' ml/kg/min';
  }
  if (first.globalHrmax && first.globalHrmax !== '0') {
    document.getElementById('global-hrmax').value = first.globalHrmax;
    document.getElementById('prof-hrmax-val').textContent = first.globalHrmax + ' bpm';
  }
  if (first.globalHrrest && first.globalHrrest !== '0') {
    document.getElementById('global-hrrest').value = first.globalHrrest;
    document.getElementById('prof-hrrest-val').textContent = first.globalHrrest + ' bpm';
  }
  updateVO2maxEstimate();
  state.forEach(bd => {
    // Skip blank blocks that were saved before the content guard was added
    if (!bd.movements?.length && !bd.cwod && !bd.intKey) return;
    const id = bd.id;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildBlockHTML(id);
    const blockEl = wrapper.firstElementChild;
    document.getElementById('timeline').appendChild(blockEl);

    // Restore modality
    const modeEl = blockEl.querySelector('.b-mode');
    if (modeEl) { modeEl.value = bd.mode; updateBlockUI(modeEl); }

    // Restore config picker values + display labels
    const setPicker = (cls, val) => {
      const inp = blockEl.querySelector('.' + cls);
      if (!inp) return;
      inp.value = val;
      const trig = inp.closest('.picker-trigger');
      if (trig) trig.querySelector('.picker-trigger-val').textContent = formatPickerVal(parseFloat(val)||0, trig.dataset.label);
    };
    setPicker('b-cap', bd.cap); setPicker('b-target', bd.target);
    setPicker('b-dur', bd.dur); setPicker('b-int', bd.int);
    setPicker('b-total-int', bd.totalInt); setPicker('b-work', bd.work);
    setPicker('b-rest', bd.rest); setPicker('b-tab-r', bd.tabR);
    setPicker('res-r', bd.resR); setPicker('res-x', bd.resX);
    setPicker('res-m', bd.resM); setPicker('res-s', bd.resS);
    setPicker('res-emom', bd.resEmom);
    if (bd.resMvData) {
      const mvInp = blockEl.querySelector('.res-mv-data');
      if (mvInp) mvInp.value = bd.resMvData;
    }
    if (bd.maxReps) blockEl.dataset.maxReps = bd.maxReps;

    // Restore EMOM interruptor
    if (bd.intKey) {
      const intKeyEl = blockEl.querySelector('.int-key');
      if (intKeyEl) intKeyEl.value = bd.intKey;
      const intSearch = blockEl.querySelector('.emom-accordion .m-search');
      if (intSearch) intSearch.value = bd.intSearch || bd.intKey;
      setPicker('int-reps', bd.intReps);
      setPicker('int-wt', bd.intWt);
      setPicker('int-sec', bd.intSec);
      // Re-apply BW lock if the saved movement is BW type
      if (MASTER_DB[bd.intKey]?.type === 'bw') {
        const intWtInp = blockEl.querySelector('.int-wt');
        if (intWtInp) {
          intWtInp.value = 0;
          const intWtTrig = intWtInp.closest('.picker-trigger');
          if (intWtTrig) setPickerDisabled(intWtTrig, true);
        }
      }
    }
    if (bd.emomPenaltyEnabled) {
      blockEl.querySelector('.emom-accordion')?.classList.add('penalty-on');
      const chk = blockEl.querySelector('.emom-enabled');
      if (chk) chk.checked = true;
      // Show EMOM result field when penalty is active
      blockEl.querySelector('.res-emom-wrap')?.classList.remove('hidden-el');
    }
    if (bd.emomOpen) {
      blockEl.querySelector('.emom-accordion')?.classList.add('open');
    }

    // Restore Classic WOD accordion state and description
    if (bd.cwodOpen) blockEl.querySelector('.classic-accordion')?.classList.add('open');
    if (bd.cwod) {
      const cwodSel = blockEl.querySelector('.cwod-select');
      if (cwodSel) cwodSel.value = bd.cwod;
// Re-apply description and ladder config (descriptionOnly=true — movements restored below)
      applyClassicWOD(id, bd.cwod, true);
    }

    // Restore ladder config
    if (bd.ladderType && bd.ladderType !== 'fixed') {
      blockEl.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = bd.ladderType);
      const startInp = blockEl.querySelector('.b-ladder-start');
      const incInp   = blockEl.querySelector('.b-ladder-inc');
      if (startInp) {
        startInp.value = bd.ladderStart || '5';
        const st = startInp.closest('.picker-trigger');
        if (st) st.querySelector('.picker-trigger-val').textContent = bd.ladderStart || '5';
      }
      if (incInp) {
        incInp.value = bd.ladderInc || '5';
        const it = incInp.closest('.picker-trigger');
        if (it) it.querySelector('.picker-trigger-val').textContent = bd.ladderInc || '5';
      }
      blockEl.querySelectorAll('.ladder-fields').forEach(f => f.style.display = '');
      blockEl.querySelectorAll('.ladder-type-btn').forEach(btn => {
        const active = btn.dataset.type === bd.ladderType;
        btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
        btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
        btn.style.color       = active ? 'white'        : 'var(--text)';
      });
      updateLadderPreview(id);
    }

    // Restore movements
    const mList = blockEl.querySelector('.m-list');
    bd.movements.forEach(mv => {
      const d = document.createElement('div'); d.className = 'movement-block';
      const disabledAttr = mv.bwLocked ? 'disabled' : '';
      d.innerHTML = `
        <input type="text" class="m-search" value="${mv.name}" style="display:none">
        <input type="hidden" value="${mv.name}">
        <input type="number" class="m-reps" value="${mv.reps}" style="display:none">
        <input type="hidden" class="m-wt-ladder-type" value="${mv.wtLadderType||'fixed'}">
        <input type="number" class="m-wt-ladder-inc" value="${mv.wtLadderInc||5}" style="display:none">
        <input type="hidden" class="m-controlled-descent" value="${mv.controlledDescent===false?'0':'1'}">
        <input type="hidden" class="m-reps-override" value="${mv.repsOverride||0}">
        <input type="hidden" class="m-reps-scheme" value="${mv.repsScheme||'fixed'}">
        <input type="hidden" class="m-reps-inc" value="${mv.repsInc||5}">
        ${makePicker('m-wt', parseFloat(mv.kg)||0, VALS.kg, 'Weight (kg)', disabledAttr)}`;
      mList.appendChild(d);
    });
  });

  updateBlockNumbers();
  updateBlueprint();
  return true;
}

/* Auto-save whenever anything changes in the timeline */
function autoSave() {
  saveWorkoutState();
}

const TEMPLATES_KEY = 'wod_architect_templates';
function getTemplates() { try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY)) || []; } catch(e) { return []; } }
function saveTemplates(arr) { try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(arr)); } catch(e) {} }

function serializeBlocksForTemplate() {
  const blocks = document.querySelectorAll('.wod-block'), out = [];
  blocks.forEach(b => {
    const hasM = b.querySelectorAll('.movement-block').length > 0;
    const hasCw = b.querySelector('.cwod-select')?.value;
    const hasEm = b.querySelector('.int-key')?.value;
    if (!hasM && !hasCw && !hasEm) return;
    const bd = {
      mode: b.querySelector('.b-mode')?.value||'fortime',
      cwodOpen: b.querySelector('.classic-accordion')?.classList.contains('open')||false,
      cwod: b.querySelector('.cwod-select')?.value||'',
      emomOpen: b.querySelector('.emom-accordion')?.classList.contains('open')||false,
      emomPenaltyEnabled: b.querySelector('.emom-accordion')?.classList.contains('penalty-on')||false,
      cap:b.querySelector('.b-cap')?.value||'15', target:b.querySelector('.b-target')?.value||'5',
      dur:b.querySelector('.b-dur')?.value||'10', int:b.querySelector('.b-int')?.value||'60',
      totalInt:b.querySelector('.b-total-int')?.value||'15', work:b.querySelector('.b-work')?.value||'20',
      rest:b.querySelector('.b-rest')?.value||'10', tabR:b.querySelector('.b-tab-r')?.value||'8',
      intKey:b.querySelector('.int-key')?.value||'', intSearch:b.querySelector('.emom-accordion .m-search')?.value||'',
      intReps:b.querySelector('.int-reps')?.value||'5', intWt:b.querySelector('.int-wt')?.value||'0',
      intSec:b.querySelector('.int-sec')?.value||'60', maxReps:b.dataset.maxReps||'0',
      ladderType:b.querySelector('.b-ladder-type')?.value||'fixed',
      ladderStart:b.querySelector('.b-ladder-start')?.value||'5',
      ladderInc:b.querySelector('.b-ladder-inc')?.value||'5',
      movements:[]
    };
    b.querySelectorAll('.movement-block').forEach(mb => {
      const repsInp = mb.querySelector('.m-reps');
      const wtInp   = mb.querySelector('.m-wt input');
      const rawKg   = parseFloat(mb.querySelector('.m-wt')?.value)||0;
      const kg      = rawKg === 999 ? 999 : rawKg; // preserve 999 sentinel in template
      bd.movements.push({name:mb.querySelector('input[type="hidden"]')?.value||'',
        reps:repsInp?.value||'0', kg: String(kg),
        maxRepsEntered: parseFloat(repsInp?.dataset.maxRepsEntered)||0,
        maxKgEntered:   parseFloat(wtInp?.dataset.maxKgEntered)||0,
        bwLocked:mb.querySelector('.m-wt')?.disabled||false,
        wtLadderType:  mb.querySelector('.m-wt-ladder-type')?.value  || 'fixed',
        wtLadderInc:   mb.querySelector('.m-wt-ladder-inc')?.value   || '5',
        repsOverride:  mb.querySelector('.m-reps-override')?.value   || '0',
        repsScheme:    mb.querySelector('.m-reps-scheme')?.value      || 'fixed',
        repsInc:       mb.querySelector('.m-reps-inc')?.value         || '5',
        controlledDescent: mb.querySelector('.m-controlled-descent')?.value !== '0'});
    });
    // Result data — save directly for history display
    const bM2 = parseFloat(b.querySelector('.res-m')?.value) || 0;
    const bS2 = parseFloat(b.querySelector('.res-s')?.value) || 0;
    const bR2 = parseFloat(b.querySelector('.res-r')?.value) || 0;
    const bX2 = parseFloat(b.querySelector('.res-x')?.value) || 0;
    bd.result = { m: bM2, s: bS2, r: bR2, x: bX2 };
    out.push(bd);
  });
  return out;
}

function restoreBlocksFromTemplate(blocks) {
  document.getElementById('timeline').innerHTML = '';
  blocks.forEach(bd => {
    if (!bd.movements?.length && !bd.cwod && !bd.intKey) return;
    const id = 'block_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildBlockHTML(id);
    const blockEl = wrapper.firstElementChild;
    document.getElementById('timeline').appendChild(blockEl);
    const modeEl = blockEl.querySelector('.b-mode');
    if (modeEl) { modeEl.value = bd.mode; updateBlockUI(modeEl); }
    const sp = (cls, val) => {
      const inp = blockEl.querySelector('.'+cls); if (!inp) return;
      inp.value = val;
      const trig = inp.closest('.picker-trigger');
      if (trig) trig.querySelector('.picker-trigger-val').textContent = formatPickerVal(parseFloat(val)||0, trig.dataset.label);
    };
    sp('b-cap',bd.cap); sp('b-target',bd.target); sp('b-dur',bd.dur); sp('b-int',bd.int);
    sp('b-total-int',bd.totalInt); sp('b-work',bd.work); sp('b-rest',bd.rest); sp('b-tab-r',bd.tabR);
    if (bd.intKey) {
      const ik=blockEl.querySelector('.int-key'); if(ik) ik.value=bd.intKey;
      const is=blockEl.querySelector('.emom-accordion .m-search'); if(is) is.value=bd.intSearch||bd.intKey;
      sp('int-reps',bd.intReps); sp('int-wt',bd.intWt); sp('int-sec',bd.intSec);
      if (MASTER_DB[bd.intKey]?.type==='bw') {
        const iw=blockEl.querySelector('.int-wt');
        if(iw){iw.value=0; const iwt=iw.closest('.picker-trigger'); if(iwt) setPickerDisabled(iwt,true);}
      }
    }
    if (bd.emomPenaltyEnabled) {
      blockEl.querySelector('.emom-accordion')?.classList.add('penalty-on');
      const chk=blockEl.querySelector('.emom-enabled'); if(chk) chk.checked=true;
      blockEl.querySelector('.res-emom-wrap')?.classList.remove('hidden-el');
    }
    if (bd.emomOpen)  blockEl.querySelector('.emom-accordion')?.classList.add('open');
    if (bd.cwodOpen)  blockEl.querySelector('.classic-accordion')?.classList.add('open');
    if (bd.cwod) {
      const cs = blockEl.querySelector('.cwod-select');
      if (cs) cs.value = bd.cwod;
      // Re-apply classic WOD description and ladder config only (not movements — restored below)
      applyClassicWOD(id, bd.cwod, true); // true = descriptionOnly
    }
    // Restore ladder config (may override classic WOD ladder if manually changed)
    if (bd.ladderType && bd.ladderType !== 'fixed') {
      blockEl.querySelectorAll('.b-ladder-type').forEach(inp => inp.value = bd.ladderType);
      const startInp = blockEl.querySelector('.b-ladder-start');
      const incInp   = blockEl.querySelector('.b-ladder-inc');
      if (startInp) {
        startInp.value = bd.ladderStart || '5';
        const st = startInp.closest('.picker-trigger');
        if (st) st.querySelector('.picker-trigger-val').textContent = bd.ladderStart || '5';
      }
      if (incInp) {
        incInp.value = bd.ladderInc || '5';
        const it = incInp.closest('.picker-trigger');
        if (it) it.querySelector('.picker-trigger-val').textContent = bd.ladderInc || '5';
      }
      // Show ladder fields and update button styles
      blockEl.querySelectorAll('.ladder-fields').forEach(f => f.style.display = '');
      blockEl.querySelectorAll('.ladder-type-btn').forEach(btn => {
        const active = btn.dataset.type === bd.ladderType;
        btn.style.borderColor = active ? 'var(--brand)' : 'var(--border)';
        btn.style.background  = active ? 'var(--brand)' : 'var(--surface2)';
        btn.style.color       = active ? 'white'        : 'var(--text)';
      });
      updateLadderPreview(id);
    }
    if (bd.maxReps)   blockEl.dataset.maxReps=bd.maxReps;
    const mList=blockEl.querySelector('.m-list');
    bd.movements.forEach(mv => {
      const d=document.createElement('div'); d.className='movement-block';
      const kgVal = parseFloat(mv.kg)||0;
      d.innerHTML=`<input type="text" class="m-search" value="${mv.name}" style="display:none">
        <input type="hidden" value="${mv.name}">
        <input type="number" class="m-reps" value="${mv.reps}" style="display:none">
        <input type="hidden" class="m-wt-ladder-type" value="${mv.wtLadderType||'fixed'}">
        <input type="number" class="m-wt-ladder-inc" value="${mv.wtLadderInc||5}" style="display:none">
        <input type="hidden" class="m-controlled-descent" value="${mv.controlledDescent===false?'0':'1'}">
        ${makePicker('m-wt', kgVal, VALS.kg, 'Weight (kg)', mv.bwLocked?'disabled':'')}`;
      mList.appendChild(d);
      // Restore maxKgEntered if present
      if (mv.maxKgEntered) {
        const wtI = d.querySelector('.m-wt');
        if (wtI) wtI.dataset.maxKgEntered = mv.maxKgEntered;
      }
      // Restore maxRepsEntered if present
      if (mv.maxRepsEntered) {
        const rI = d.querySelector('.m-reps');
        if (rI) rI.dataset.maxRepsEntered = mv.maxRepsEntered;
      }
    });
  });
  updateBlockNumbers(); updateBlueprint(); renderBlockList(); autoSave();
}

function saveAsTemplate() {
  const blocks = serializeBlocksForTemplate();
  if (!blocks.length) { showToast(t('toast.add.block'), 'error'); return; }
  const ml={fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata'};
  let dn='';
  const fb=document.querySelector('.wod-block');
  if (fb) {
    const cw=fb.querySelector('.cwod-select')?.value;
    if (cw) dn=cw;
    else { const m=fb.querySelector('.b-mode')?.value||'fortime'; const c=document.querySelectorAll('.wod-block').length; dn=c>1?c+'-Block '+(ml[m]||m):(ml[m]||m); }
  }
  const rest=document.getElementById('rest-duration-sec')?.value||'0';

  // Edit mode — overwrite existing template
  if (_editingTemplateId) {
    const templates = getTemplates();
    const idx = templates.findIndex(t => t.id === _editingTemplateId);
    if (idx !== -1) {
      const existingName = templates[idx].name;
      const name = prompt('Template name:', existingName); if (!name) return;
      templates[idx] = { ...templates[idx], name: name.trim(), blocks, restDuration: rest };
      saveTemplates(templates);
      const tpl = templates[idx];
      _editingTemplateId = null;
      showToast(t('toast.template.saved') + ': ' + name);
      // Sync to cloud
      const sb = getSB();
      if (sb) {
        (async () => {
          const { data: { session } } = await sb.auth.getSession();
          if (!session?.user) return;
          const { error } = await sb.from('templates')
            .upsert({ id: tpl.id, user_id: session.user.id, name: tpl.name, created_at: tpl.createdAt, rest_duration: tpl.restDuration || '0', blocks: tpl.blocks })
            .select();
          if (error) console.warn('[template rename] upsert error:', error);
        })();
      }
      return;
    }
    _editingTemplateId = null; // fallthrough if not found
  }

  const name=prompt('Template name:', dn); if (!name) return;
  const tpl={id:'tpl_'+Date.now(), name:name.trim(), createdAt:new Date().toISOString(), restDuration:rest, blocks};
  const templates=getTemplates(); templates.unshift(tpl); saveTemplates(templates);
  showToast(t('toast.template.saved') + ': ' + name);
  // Also save to cloud if signed in
  const sb = getSB();
  if (sb) {
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user) return;
      const { error } = await sb.from('templates').upsert({
        id: tpl.id, user_id: session.user.id, name: tpl.name,
        created_at: tpl.createdAt, rest_duration: tpl.restDuration || '0', blocks: tpl.blocks
      }).select();
      if (error) console.warn('[template save] upsert error:', error);
    })();
  }
}

let _editingTemplateId = null; // set when editing an existing template

function editTemplate(id) {
  const tpl = getTemplates().find(t => t.id === id);
  if (!tpl) return;
  if (!confirm('Load "' + tpl.name + '" for editing? Your current blocks will be replaced.')) return;
  closeTemplatePanel();
  // Restore blocks into builder
  const re = document.getElementById('rest-duration-sec'), rd = document.getElementById('rest-duration-val');
  if (re && tpl.restDuration) {
    re.value = tpl.restDuration;
    const rl = {'0':t('timer.no.rest.label'),'30':'30 sec','60':'1 min','90':'1:30 min','120':'2 min','180':'3 min','300':'5 min'};
    if (rd) rd.textContent = rl[tpl.restDuration] || tpl.restDuration + 's';
    localStorage.setItem('wod_rest_duration', tpl.restDuration);
  }
  restoreBlocksFromTemplate(tpl.blocks);
  _editingTemplateId = id;
  // Show edit mode indicator
  showToast('✏️ Editing: ' + tpl.name + ' — tap Save to update');
}

function openTemplatePanel() {
  renderTemplatePanel();
  const panel = document.getElementById('template-panel');
  if (panel) {
    panel.classList.add('open');
    panel.scrollTop = 0;
  }
  // Scroll the builder screen to top so the template panel covers it correctly
  const builderScreen = document.getElementById('screen-builder');
  if (builderScreen) builderScreen.scrollTop = 0;
  const fab=document.querySelector('.builder-fab'); if(fab) fab.style.display='none';
}

function closeTemplatePanel() {
  document.getElementById('template-panel')?.classList.remove('open');
  const fab=document.querySelector('.builder-fab');
  if(fab) fab.style.display=(!_openBlockId&&!_openMovBlockId)?'flex':'none';
}

function loadTemplate(id, isBenchmark) {
  if (!confirm('Load this template? Your current blocks will be replaced.')) return;
  closeTemplatePanel();
  if (isBenchmark) {
    const wod=CLASSIC_WODS[id]; if(!wod) return;
    const isFemale=(document.getElementById('global-gender')?.value==='female');
    const bd={mode:wod.mode, cwod:id, cwodOpen:true, emomPenaltyEnabled:false, emomOpen:false,
      cap:wod.cap||'15', target:wod.rounds||'1', dur:wod.duration||'20', int:wod.interval||'60',
      totalInt:wod.totalIntervals||'15', work:'20', rest:'10', tabR:'8',
      intKey:'', intSearch:'', intReps:'5', intWt:'0', intSec:'60',
      maxReps:wod.maxReps?'1':'0',
      movements:wod.movements(isFemale).map(mv=>({name:mv.name, reps:mv.reps||0, kg:mv.kg||0, bwLocked:mv.kg===0}))};
    restoreBlocksFromTemplate([bd]);
    _activeTemplateName = id;
    const fb=document.querySelector('.wod-block'); if(fb) applyClassicWOD(fb.id, id);
  } else {
    const tpl=getTemplates().find(t=>t.id===id); if(!tpl) return;
    const re=document.getElementById('rest-duration-sec'), rd=document.getElementById('rest-duration-val');
    if (re&&tpl.restDuration) {
      re.value=tpl.restDuration;
      const rl={'0':t('timer.no.rest.label'),'30':'30 sec','60':'1 min','90':'1:30 min','120':'2 min','180':'3 min','300':'5 min'};
      if(rd) rd.textContent=rl[tpl.restDuration]||tpl.restDuration+'s';
      localStorage.setItem('wod_rest_duration',tpl.restDuration);
    }
    restoreBlocksFromTemplate(tpl.blocks);
    _activeTemplateName = tpl.name;
  }
  showToast(t('toast.template.load') + ': ' + (_activeTemplateName || 'Custom WOD'));
}

function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  saveTemplates(getTemplates().filter(t=>t.id!==id));
  renderTemplatePanel();
  // Auto-delete from Supabase
  const sbInst = getSB();
  if (sbInst) {
    sbInst.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      sbInst.from('templates').delete().eq('id', id).eq('user_id', session.user.id)
        .then(({ error }) => {
          if (error) { queueDelete('template', id); console.log('[sync] Template delete queued'); }
          else { console.log('[sync] Template deleted from cloud'); }
        });
    });
  }
}

// Template view state
let _tplView = localStorage.getItem('wod-tpl-view') || 'list';
let _tplMain = localStorage.getItem('wod-tpl-main') || 'mytpl';
let _tplCalDate = new Date();
let _tplCalSelected = null;

function setTplMain(main) {
  _tplMain = main;
  localStorage.setItem('wod-tpl-main', main);
  const benchmarkView = document.getElementById('tpl-benchmark-view');
  const listView      = document.getElementById('tpl-list-view');
  const calView       = document.getElementById('tpl-cal-view');
  const benchBtn      = document.getElementById('tpl-main-benchmark');
  const mytplBtn      = document.getElementById('tpl-main-mytpl');
  const subToggle     = document.getElementById('tpl-sub-toggle');

  // Main button pill styles
  if (benchBtn) { benchBtn.style.background = main === 'benchmark' ? 'var(--brand)' : 'transparent'; benchBtn.style.color = main === 'benchmark' ? 'white' : 'var(--label)'; benchBtn.style.borderColor = main === 'benchmark' ? 'var(--brand)' : 'var(--border)'; }
  if (mytplBtn) { mytplBtn.style.background = main === 'mytpl' ? 'var(--brand)' : 'transparent'; mytplBtn.style.color = main === 'mytpl' ? 'white' : 'var(--label)'; mytplBtn.style.borderColor = main === 'mytpl' ? 'var(--brand)' : 'var(--border)'; }

  // Show/hide sub toggle
  if (subToggle) subToggle.style.display = main === 'mytpl' ? 'flex' : 'none';

  if (main === 'benchmark') {
    if (benchmarkView) benchmarkView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    if (calView)  calView.style.display  = 'none';
  } else {
    if (benchmarkView) benchmarkView.style.display = 'none';
    setTplView(_tplView);
  }
}

function setTplView(view) {
  _tplView = view;
  localStorage.setItem('wod-tpl-view', view);
  const listView = document.getElementById('tpl-list-view');
  const calView  = document.getElementById('tpl-cal-view');
  const listBtn  = document.getElementById('tpl-view-list');
  const calBtn   = document.getElementById('tpl-view-cal');
  if (listView) listView.style.display = view === 'list' ? 'block' : 'none';
  if (calView)  calView.style.display  = view === 'cal'  ? 'block' : 'none';
  if (listBtn) { listBtn.style.background = view === 'list' ? 'var(--brand)' : 'transparent'; listBtn.style.color = view === 'list' ? 'white' : 'var(--label)'; listBtn.style.borderColor = view === 'list' ? 'var(--brand)' : 'var(--border)'; }
  if (calBtn)  { calBtn.style.background  = view === 'cal'  ? 'var(--brand)' : 'transparent'; calBtn.style.color  = view === 'cal'  ? 'white' : 'var(--label)'; calBtn.style.borderColor  = view === 'cal'  ? 'var(--brand)' : 'var(--border)'; }
  if (view === 'cal') renderTplCalendar();
}

function tplCalNav(dir) {
  _tplCalDate = new Date(_tplCalDate.getFullYear(), _tplCalDate.getMonth() + dir, 1);
  _tplCalSelected = null;
  renderTplCalendar();
}

function renderTplCalendar() {
  const grid    = document.getElementById('tpl-cal-grid');
  const monthEl = document.getElementById('tpl-cal-month');
  const calList = document.getElementById('tpl-cal-list');
  const selDate = document.getElementById('tpl-cal-selected-date');
  if (!grid) return;
  const year  = _tplCalDate.getFullYear();
  const month = _tplCalDate.getMonth();
  const templates = getTemplates();
  const dateMap = {};
  templates.forEach(tpl => {
    const d = localDateStr(new Date(tpl.createdAt));
    if (!dateMap[d]) dateMap[d] = [];
    dateMap[d].push(tpl);
  });
  const monthNames = t('tpl.months').split(',');
  if (monthEl) monthEl.textContent = `${monthNames[month]} ${year}`;
  const dows = t('tpl.days').split(',');
  let html = dows.map(d => `<div class="hist-cal-dow">${d}</div>`).join('');
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());
  for (let i = 0; i < firstDay; i++) html += '<div class="hist-cal-day other-month"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasTpls = dateMap[dateStr]?.length > 0;
    const isToday = dateStr === todayStr;
    const isSel   = dateStr === _tplCalSelected;
    let cls = 'hist-cal-day';
    if (hasTpls) cls += ' has-session';
    if (isToday) cls += ' today';
    if (isSel)   cls += ' selected';
    const dot = hasTpls ? `<div class="hist-cal-dot-wrap"><div class="hist-cal-dot${(dateMap[dateStr]?.length||0)>1?' multi':''}"></div></div>` : '';
    html += `<div class="${cls}" onclick="selectTplCalDate('${dateStr}')"><span class="hist-cal-dn">${d}</span>${dot}</div>`;
  }
  grid.innerHTML = html;

  const monthNames2 = t('tpl.months').split(',');
  const labelEl = document.getElementById('tpl-cal-list-label');
  const ml = {fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata',exmom:'EXMOM'};
  let displayTpls = [];
  if (_tplCalSelected && dateMap[_tplCalSelected]) {
    displayTpls = dateMap[_tplCalSelected];
    if (labelEl) labelEl.textContent = _tplCalSelected;
  } else {
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
    Object.keys(dateMap).filter(d => d.startsWith(monthStr)).sort().forEach(d => displayTpls.push(...dateMap[d]));
    if (labelEl) labelEl.textContent = displayTpls.length ? `${monthNames2[month]} ${year}` : '';
  }
  if (calList) calList.innerHTML = displayTpls.length ? displayTpls.map(tpl => _tplCardHTML(tpl)).join('') : `<div style="text-align:center;padding:20px;color:var(--label);font-size:.78rem;">${t('tpl.no.month')} ${monthNames2[month]}</div>`;
}

function selectTplCalDate(dateStr) {
  _tplCalSelected = _tplCalSelected === dateStr ? null : dateStr;
  renderTplCalendar();
}

// Template filter state
let _tplMovSelected = '';
const _tplFilter = {
  modality: 'all', blocks: 'all', timecap: 'all',
  repscheme: 'all', wtscheme: 'all', pattern: 'all',
  sort: 'date', sortDir: 'desc'
};

function toggleTplFilter() {
  const bar = document.getElementById('tpl-filter-bar');
  if (bar) bar.classList.toggle('open');
}

function selectTplChip(category, el) {
  const row = el.closest('.hist-chip-row');
  if (!row) return;
  row.querySelectorAll('.hist-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _tplFilter[category] = el.dataset.val;
  renderUserTemplates();
  _updateTplBadges();
}

function toggleTplSortDir() {
  _tplFilter.sortDir = _tplFilter.sortDir === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('tpl-sort-dir');
  if (btn) btn.textContent = _tplFilter.sortDir === 'desc' ? '↓' : '↑';
  renderUserTemplates();
}

function clearTplFilters() {
  _tplFilter.modality = 'all'; _tplFilter.blocks = 'all';
  _tplFilter.timecap = 'all'; _tplFilter.repscheme = 'all';
  _tplFilter.wtscheme = 'all'; _tplFilter.pattern = 'all';
  _tplFilter.sort = 'date'; _tplFilter.sortDir = 'desc';
  _tplMovSelected = '';
  // Reset chips
  document.querySelectorAll('.hist-chip-row').forEach(row => {
    row.querySelectorAll('.hist-chip').forEach(c => c.classList.remove('active'));
    const first = row.querySelector('.hist-chip');
    if (first) first.classList.add('active');
  });
  // Reset movement input
  const inp = document.getElementById('tpl-mov1');
  const clr = document.getElementById('tpl-mov1-clear');
  const drp = document.getElementById('tpl-mov1-drop');
  if (inp) inp.value = '';
  if (clr) clr.style.display = 'none';
  if (drp) drp.style.display = 'none';
  // Reset sort select and dir
  const sel = document.getElementById('tpl-sort-field');
  const dir = document.getElementById('tpl-sort-dir');
  if (sel) sel.value = 'date';
  if (dir) dir.textContent = '↓';
  renderUserTemplates();
  _updateTplBadges();
}

function applyTplFilter() {
  const sel = document.getElementById('tpl-sort-field');
  if (sel) _tplFilter.sort = sel.value;
  renderUserTemplates();
}

function _updateTplBadges() {
  const badges = document.getElementById('tpl-active-badges');
  if (!badges) return;
  const active = ['modality','blocks','timecap','repscheme','wtscheme','pattern']
    .filter(k => _tplFilter[k] !== 'all').length + (_tplMovSelected ? 1 : 0);
  badges.innerHTML = active > 0
    ? `<span style="background:var(--brand);color:white;border-radius:10px;padding:1px 7px;font-size:.65rem;font-weight:800;margin-left:6px;">${active}</span>`
    : '';
}

function _updateTplFilterLabel() {
  // kept for compatibility — badges now handled by _updateTplBadges
}

const GIRLS_WODS = new Set(['Amanda','Angie','Annie','Barbara','Chelsea','Cindy','Diane','Elizabeth','Eva','Fran','Grace','Helen','Isabel','Jackie','Karen','Kelly','Linda','Lynne','Mary','Nancy','Nicole']);

function onTplMovInput() {
  const input = document.getElementById('tpl-mov1');
  const drop  = document.getElementById('tpl-mov1-drop');
  const clear = document.getElementById('tpl-mov1-clear');
  const val   = input.value.trim().toLowerCase();
  _tplMovSelected = '';
  if (clear) clear.style.display = 'none';
  _updateTplBadges();
  if (!val) { drop.style.display = 'none'; renderUserTemplates(); return; }
  const matches = Object.keys(MASTER_DB)
    .filter(k => k.toLowerCase().includes(val))
    .sort((a,b) => a.localeCompare(b))
    .slice(0, 20);
  if (!matches.length) { drop.style.display = 'none'; renderUserTemplates(); return; }
  drop.innerHTML = matches.map(m =>
    `<div onclick="selectTplMov('${m.replace(/'/g,"\\'")}')" style="padding:8px 10px;font-size:.76rem;color:var(--text);cursor:pointer;border-bottom:0.5px solid var(--glass-border);">${m}</div>`
  ).join('');
  drop.style.display = 'block';
}

function selectTplMov(name) {
  const input = document.getElementById('tpl-mov1');
  const drop  = document.getElementById('tpl-mov1-drop');
  const clear = document.getElementById('tpl-mov1-clear');
  input.value = name;
  _tplMovSelected = name;
  drop.style.display = 'none';
  if (clear) clear.style.display = 'block';
  _updateTplBadges();
  renderUserTemplates();
}

function clearTplMov() {
  const input = document.getElementById('tpl-mov1');
  const clear = document.getElementById('tpl-mov1-clear');
  input.value = '';
  _tplMovSelected = '';
  if (clear) clear.style.display = 'none';
  _updateTplBadges();
  renderUserTemplates();
}

function _updateTplFilterLabel() {
  const label = document.getElementById('tpl-filter-label');
  if (!label) return;
  label.textContent = _tplMovSelected
    ? `🔍 ${_tplMovSelected}`
    : '🔍 Filter by movement';
  label.style.color = _tplMovSelected ? 'var(--brand)' : 'var(--label)';
}

function toggleTplSection(section) {
  const body    = document.getElementById(`tpl-${section}-body`);
  const chevron = document.getElementById(`tpl-${section}-chevron`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
  localStorage.setItem(`wod-tpl-${section}-open`, !open);
}

function _tplCardHTML(tpl) {
  const bc    = tpl.blocks?.length || 0;
  const date  = fmtDate(new Date(tpl.createdAt), {day:'2-digit',month:'short'});
  const ml    = {fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata',exmom:'EXMOM'};
  const modes = [...new Set((tpl.blocks||[]).map(b => ml[b.mode]||b.mode))].join(' + ');

  // Build expanded body
  let body = '';
  (tpl.blocks||[]).forEach((b, bi) => {
    const modeLbl = ml[b.mode] || b.mode;
    const cap  = b.cap  ? `${b.cap}m` : '';
    const rounds = parseInt(b.target) || 1;
    const ints = b.mode === 'emom' || b.mode === 'exmom' ? `${b.totalInt||b.target||'?'} × ${b.int||'?'}s` : rounds > 1 ? `${rounds} rounds` : '';
    const info = [modeLbl, cap, ints].filter(Boolean).join(' · ');
    body += `<div style="margin-top:10px;">`;
    body += `<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--brand);margin-bottom:4px;">Block ${bi+1} — ${info}</div>`;
    (b.movements||[]).forEach(m => {
      const baseKg  = parseFloat(m.kg) || 0;
      const baseReps = parseInt(m.reps) || 0;
      const wtInc   = parseFloat(m.wtLadderInc) || 0;
      const repInc  = parseInt(m.repsInc) || 0;
      const wtScheme  = m.wtLadderType || 'fixed';
      const repScheme = m.repsScheme || 'fixed';
      const isWtLadder  = wtScheme !== 'fixed' && wtInc > 0 && rounds > 1;
      const isRepLadder = repScheme !== 'fixed' && repInc > 0 && rounds > 1;

      if (isWtLadder || isRepLadder) {
        // Show round-by-round progression
        body += `<div style="font-size:.76rem;font-weight:700;color:var(--text);padding:3px 0;">${m.name}</div>`;
        for (let r = 0; r < rounds; r++) {
          let kg = baseKg, reps = baseReps;
          if (wtScheme === 'ascending')  kg = baseKg + wtInc * r;
          if (wtScheme === 'descending') kg = baseKg - wtInc * r;
          if (repScheme === 'pyramid')   reps = baseReps + repInc * r;
          if (repScheme === 'valley')    reps = baseReps - repInc * r;
          if (repScheme === 'ladder')    reps = baseReps + repInc * r;
          const wtStr = kg === 0 ? 'BW' : `${kg}kg`;
          body += `<div style="font-size:.72rem;color:var(--label);padding:1px 0 1px 8px;border-bottom:0.5px solid var(--glass-border);">Rd ${r+1}: ${reps}× @ ${wtStr}</div>`;
        }
      } else {
        const wt = baseKg === 0 ? 'BW' : baseKg === 999 ? 'Max' : `${baseKg}kg`;
        const rep = baseReps ? `${baseReps}×` : '';
        body += `<div style="font-size:.76rem;color:var(--text);padding:2px 0;border-bottom:0.5px solid var(--glass-border);">${rep} ${m.name} <span style="color:var(--label);">@ ${wt}</span></div>`;
      }
    });
    body += `</div>`;
  });

  return `<div class="template-card" data-id="${tpl.id}">
    <div class="template-card-header" onclick="toggleTplCard('${tpl.id}')">
      <div class="template-card-info">
        <div class="template-card-name">${tpl.name}</div>
        <div class="template-card-sub">${bc} block${bc!==1?'s':''} · ${modes} · ${date}</div>
      </div>
      <div class="template-card-actions" onclick="event.stopPropagation()">
        <button class="template-action-btn load" onclick="loadTemplate('${tpl.id}',false)"><span data-i18n="btn.load">Load</span></button>
        <button class="template-action-btn load" onclick="editTemplate('${tpl.id}')"><span data-i18n="btn.edit">Edit</span></button>
        <button class="template-action-btn del" onclick="deleteTemplate('${tpl.id}')">Del</button>
      </div>
      <span class="template-card-chevron">▼</span>
    </div>
    <div class="template-card-body">${body}</div>
  </div>`;
}

function toggleTplCard(id) {
  const all = document.querySelectorAll('.template-card');
  all.forEach(card => {
    if (card.dataset.id === id) card.classList.toggle('open');
    else card.classList.remove('open');
  });
}

function renderUserTemplates() {
  const ul = document.getElementById('user-template-list');
  const countEl = document.getElementById('tpl-count');
  if (!ul) return;
  let templates = getTemplates();
  const f = _tplFilter;

  // Apply filters
  let filtered = templates.filter(tpl => {
    const blocks = tpl.blocks || [];
    const movements = blocks.flatMap(b => b.movements || []);

    // Modality
    if (f.modality !== 'all') {
      if (!blocks.some(b => b.mode === f.modality)) return false;
    }
    // Blocks count
    if (f.blocks !== 'all') {
      const bc = blocks.length;
      if (f.blocks === '1' && bc !== 1) return false;
      if (f.blocks === '2' && bc !== 2) return false;
      if (f.blocks === '3+' && bc < 3) return false;
    }
    // Time cap
    if (f.timecap !== 'all') {
      const cap = Math.max(...blocks.map(b => parseInt(b.cap) || 0));
      if (f.timecap === 'under10' && cap >= 10) return false;
      if (f.timecap === '10to20' && (cap < 10 || cap > 20)) return false;
      if (f.timecap === 'over20' && cap <= 20) return false;
    }
    // Rep scheme
    if (f.repscheme !== 'all') {
      if (!movements.some(m => (m.repsScheme || 'fixed') === f.repscheme)) return false;
    }
    // Weight scheme
    if (f.wtscheme !== 'all') {
      if (!movements.some(m => (m.wtLadderType || 'fixed') === f.wtscheme)) return false;
    }
    // Movement pattern
    if (f.pattern !== 'all') {
      const patMap = { squat:'pattern.squat', hinge:'pattern.hinge', push:'pattern.push', pull:'pattern.pull', olympic:'pattern.olympic', core:'pattern.core', carry:'pattern.carry' };
      const target = patMap[f.pattern];
      if (!movements.some(m => getMovementPattern(m.name) === target)) return false;
    }
    // Movement search
    if (_tplMovSelected) {
      const movNames = movements.map(m => m.name.toLowerCase());
      if (!movNames.some(m => m.includes(_tplMovSelected.toLowerCase()))) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (f.sort === 'name')     cmp = a.name.localeCompare(b.name);
    else if (f.sort === 'modality') {
      const ma = (a.blocks?.[0]?.mode || '');
      const mb = (b.blocks?.[0]?.mode || '');
      cmp = ma.localeCompare(mb);
    } else {
      cmp = new Date(a.createdAt) - new Date(b.createdAt);
    }
    return f.sortDir === 'asc' ? cmp : -cmp;
  });

  const hasFilter = Object.values({modality:f.modality,blocks:f.blocks,timecap:f.timecap,repscheme:f.repscheme,wtscheme:f.wtscheme,pattern:f.pattern}).some(v => v !== 'all') || _tplMovSelected;
  if (countEl) countEl.textContent = hasFilter ? `(${filtered.length} ${t('tpl.of')} ${templates.length})` : `(${templates.length})`;

  if (!filtered.length) {
    ul.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--label);"><div style="font-size:2rem;margin-bottom:8px;">📋</div><p style="font-size:.82rem;margin:0;">${hasFilter ? t('tpl.no.match') : t('tpl.no.templates')}</p></div>`;
    return;
  }
  ul.innerHTML = filtered.map(tpl => _tplCardHTML(tpl)).join('');
}

function renderTemplatePanel() {
  // Benchmark — Girls
  const gl = document.getElementById('benchmark-girls-list');
  if (gl) {
    const ml = {fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata'};
    gl.innerHTML = Object.keys(CLASSIC_WODS).filter(n => GIRLS_WODS.has(n)).map(name => {
      const wod = CLASSIC_WODS[name];
      const movs = wod.movements(false);
      const mc = movs.length;
      const rounds = wod.rounds || 1;
      const ladder = wod.ladder;
      let body = '';
      // Mode info
      const cap = wod.cap ? `${wod.cap}m` : '';
      const info = [ml[wod.mode]||wod.mode, cap, rounds > 1 ? `${rounds} rounds` : ''].filter(Boolean).join(' · ');
      body += `<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--brand);margin-bottom:6px;">${info}</div>`;
      if (wod.description) body += `<div style="font-size:.72rem;color:var(--label);margin-bottom:6px;">${wod.description}</div>`;
      if (ladder && rounds > 1) {
        // Show round-by-round for each movement
        for (let r = 0; r < rounds; r++) {
          let reps = ladder.start;
          if (ladder.type === 'descending') reps = ladder.start - ladder.inc * r;
          if (ladder.type === 'ascending')  reps = ladder.start + ladder.inc * r;
          const movLine = movs.map(m => {
            const wt = m.kg > 0 ? ` @ ${m.kg}kg` : '';
            return `${m.name}${wt}`;
          }).join(', ');
          body += `<div style="font-size:.76rem;color:var(--text);padding:2px 0;border-bottom:0.5px solid var(--glass-border);">Rd ${r+1}: ${reps}× ${movLine}</div>`;
        }
      } else {
        movs.forEach(m => {
          const wt = m.kg > 0 ? ` <span style="color:var(--label);">@ ${m.kg}kg</span>` : '';
          body += `<div style="font-size:.76rem;color:var(--text);padding:2px 0;border-bottom:0.5px solid var(--glass-border);">${m.reps}× ${m.name}${wt}</div>`;
        });
      }
      return `<div class="template-card" data-id="bm-${name}">
        <div class="template-card-header" onclick="toggleTplCard('bm-${name}')">
          <div class="template-card-info">
            <div class="template-card-name">★ ${name}</div>
            <div class="template-card-sub">${ml[wod.mode]||wod.mode} · ${mc} movement${mc!==1?'s':''}</div>
          </div>
          <div class="template-card-actions" onclick="event.stopPropagation()">
            <button class="template-action-btn load" onclick="loadTemplate('${name}',true)"><span data-i18n="btn.load">Load</span></button>
          </div>
          <span class="template-card-chevron">▼</span>
        </div>
        <div class="template-card-body">${body}</div>
      </div>`;
    }).join('');
  }
  // Benchmark — Heroes
  const hl = document.getElementById('benchmark-heroes-list');
  if (hl) {
    const ml = {fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata'};
    hl.innerHTML = Object.keys(CLASSIC_WODS).filter(n => !GIRLS_WODS.has(n)).map(name => {
      const wod = CLASSIC_WODS[name];
      const movs = wod.movements(false);
      const mc = movs.length;
      const rounds = wod.rounds || 1;
      const ladder = wod.ladder;
      let body = '';
      const cap = wod.cap ? `${wod.cap}m` : '';
      const info = [ml[wod.mode]||wod.mode, cap, rounds > 1 ? `${rounds} rounds` : ''].filter(Boolean).join(' · ');
      body += `<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--brand);margin-bottom:6px;">${info}</div>`;
      if (wod.description) body += `<div style="font-size:.72rem;color:var(--label);margin-bottom:6px;">${wod.description}</div>`;
      if (ladder && rounds > 1) {
        for (let r = 0; r < rounds; r++) {
          let reps = ladder.start;
          if (ladder.type === 'descending') reps = ladder.start - ladder.inc * r;
          if (ladder.type === 'ascending')  reps = ladder.start + ladder.inc * r;
          const movLine = movs.map(m => {
            const wt = m.kg > 0 ? ` @ ${m.kg}kg` : '';
            return `${m.name}${wt}`;
          }).join(', ');
          body += `<div style="font-size:.76rem;color:var(--text);padding:2px 0;border-bottom:0.5px solid var(--glass-border);">Rd ${r+1}: ${reps}× ${movLine}</div>`;
        }
      } else {
        movs.forEach(m => {
          const wt = m.kg > 0 ? ` <span style="color:var(--label);">@ ${m.kg}kg</span>` : '';
          body += `<div style="font-size:.76rem;color:var(--text);padding:2px 0;border-bottom:0.5px solid var(--glass-border);">${m.reps}× ${m.name}${wt}</div>`;
        });
      }
      return `<div class="template-card" data-id="bm-${name}">
        <div class="template-card-header" onclick="toggleTplCard('bm-${name}')">
          <div class="template-card-info">
            <div class="template-card-name">★ ${name}</div>
            <div class="template-card-sub">${ml[wod.mode]||wod.mode} · ${mc} movement${mc!==1?'s':''}</div>
          </div>
          <div class="template-card-actions" onclick="event.stopPropagation()">
            <button class="template-action-btn load" onclick="loadTemplate('${name}',true)"><span data-i18n="btn.load">Load</span></button>
          </div>
          <span class="template-card-chevron">▼</span>
        </div>
        <div class="template-card-body">${body}</div>
      </div>`;
    }).join('');
  }
  // Restore section open states
  ['benchmark','girls','heroes'].forEach(s => {
    if (localStorage.getItem(`wod-tpl-${s}-open`) === 'true') {
      const body    = document.getElementById(`tpl-${s}-body`);
      const chevron = document.getElementById(`tpl-${s}-chevron`);
      if (body) body.style.display = 'block';
      if (chevron) chevron.style.transform = 'rotate(90deg)';
    }
  });
  // Apply current view
  setTplMain(_tplMain);
  // My Templates
  renderUserTemplates();
  // Close dropdowns when tapping outside
  setTimeout(() => {
    document.addEventListener('click', function closeDrop(e) {
      if (!e.target.closest('#tpl-mov1,#tpl-mov1-drop')) {
        const d = document.getElementById('tpl-mov1-drop');
        if (d) d.style.display = 'none';
        document.removeEventListener('click', closeDrop);
      }
    });
  }, 100);
}
