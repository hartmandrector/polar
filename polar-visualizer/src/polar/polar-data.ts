/**
 * Legacy polar data and conversion to ContinuousPolar.
 * 
 * Contains the three reference polars from CloudBASE:
 * - Aura 5 (wingsuit)
 * - Ibex UL (canopy)
 * - Slick Sin (skydiver)
 * 
 * Plus conversion utilities and pre-converted continuous polars.
 * This module is UI-independent.
 */

import { ContinuousPolar, Coefficients, MassSegment, AeroSegment } from './continuous-polar.ts'
import { makeCanopyCellSegment, makeParasiticSegment, makeLiftingBodySegment, makeUnzippablePilotSegment, makeBrakeFlapSegment, DEPLOY_CHORD_OFFSET } from './segment-factories.ts'
import { makeWingsuitHeadSegment, makeWingsuitLiftingSegment } from './segment-factories.ts'

// ─── Legacy Types ────────────────────────────────────────────────────────────

export interface WSEQPolar {
  type?: string
  name: string
  public?: boolean
  polarslope: number
  polarclo: number
  polarmindrag: number
  rangemincl: number
  rangemaxcl: number
  s: number
  m: number
  clstallsep?: number
  cdstallsep?: number
  clstall?: number
  cdstall?: number
  stallmaxdrag?: number
  aoaindexes?: number[]
  aoas?: number[]
  cp?: number[]
  stallpoint?: Coefficients[]
  polar_id?: string | number
  user_id?: string
}

// ─── Legacy Interpolation Functions ──────────────────────────────────────────

export function aoatoaoaindex(inputaoa: number, aoas: number[]) {
  if (inputaoa <= aoas[aoas.length - 1]) return { bottomi: aoas.length - 1, topi: aoas.length - 1, alpha: 1 }
  if (inputaoa >= aoas[0]) return { bottomi: 0, topi: 0, alpha: 0 }
  const bottomaoai = aoas.findIndex((a) => inputaoa > a)
  const topaoai = bottomaoai - 1
  const alpha = (inputaoa - aoas[bottomaoai]) / (aoas[topaoai] - aoas[bottomaoai])
  return { bottomi: bottomaoai, topi: topaoai, alpha: alpha }
}

export function interpolatecoefficients(i: { bottomi: number, topi: number, alpha: number }, stallpoint: Coefficients[]): Coefficients {
  const cl = stallpoint[i.bottomi].cl * (1 - i.alpha) + stallpoint[i.topi].cl * i.alpha
  const cd = stallpoint[i.bottomi].cd * (1 - i.alpha) + stallpoint[i.topi].cd * i.alpha
  return { cl, cd }
}

export function interpolatecp(i: { bottomi: number, topi: number, alpha: number }, cp: number[]): number {
  return cp[i.bottomi] * (1 - i.alpha) + cp[i.topi] * i.alpha
}

/**
 * Get legacy CL, CD, CP at a given AOA from a WSEQPolar.
 */
export function getLegacyCoefficients(aoa_deg: number, polar: WSEQPolar): { cl: number, cd: number, cp: number } {
  if (!polar.aoas || !polar.stallpoint) {
    return { cl: 0, cd: 0, cp: 0.4 }
  }
  const i = aoatoaoaindex(aoa_deg, polar.aoas)
  const c = interpolatecoefficients(i, polar.stallpoint)
  const cp = polar.cp ? interpolatecp(i, polar.cp) : 0.4
  return { cl: c.cl, cd: c.cd, cp }
}

// ─── Aura 5 Wingsuit ────────────────────────────────────────────────────────

const aurafivestallpoint: Coefficients[] = [
  {cl: 0.108983764628346 , cd: 1.08733},
  {cl: 0.185891612981445 , cd: 1.07550125},
  {cl: 0.210159022016888 , cd: 1.04624},
  {cl: 0.236338092608918 , cd: 1.00421875},
  {cl: 0.276174302741996 , cd: 0.95411},
  {cl: 0.321902830713497 , cd: 0.90058625},
  {cl: 0.363958657340666 , cd: 0.848320000000001},
  {cl: 0.400686482484531 , cd: 0.80198375},
  {cl: 0.443431551630603 , cd: 0.77},
  {cl: 0.501784571242392 , cd: 0.741},
  {cl: 0.516614859906805 , cd: 0.735},
  {cl: 0.533624176122725 , cd: 0.73},
  {cl: 0.548480181747974 , cd: 0.72},
  {cl: 0.564801482459875 , cd: 0.71},
  {cl: 0.582677701039275 , cd: 0.7},
  {cl: 0.602181355660182 , cd: 0.69},
  {cl: 0.623365404678184 , cd: 0.68},
  {cl: 0.646260864379027 , cd: 0.67},
  {cl: 0.670874519347125 , cd: 0.66},
  {cl: 0.70576750505298 , cd: 0.658},
  {cl: 0.759140843806183 , cd: 0.67},
  {cl: 0.810986085509315 , cd: 0.677},
  {cl: 0.88072260117917 , cd: 0.695},
  {cl: 0.965501597206807 , cd: 0.72},
  {cl: 1.05011755421627 , cd: 0.74},
  {cl: 1.1371 , cd: 0.747538425047438},
  {cl: 1.15574082635108 , cd: 0.715249918087947},
  {cl: 1.15539526148586 , cd: 0.674507873388006},
  {cl: 1.14683928171753 , cd: 0.630877095494163},
  {cl: 1.11365205723984 , cd: 0.578580118018614},
  {cl: 1.08461323582186 , cd: 0.532820262727508},
  {cl: 1.03921292555216 , cd: 0.485724926151704},
  {cl: 0.973302723371025 , cd: 0.430756986106757},
  {cl: 0.907945945116896 , cd: 0.377696088274903},
  {cl: 0.855618188821683 , cd: 0.343913198706244},
  {cl: 0.805163095460971 , cd: 0.313424543901754},
  {cl: 0.761810592507725 , cd: 0.288863037567478},
  {cl: 0.719519027870984 , cd: 0.266359012152287},
  {cl: 0.677227463234242 , cd: 0.245293347914775},
  {cl: 0.642590319337377 , cd: 0.229111816346851},
  {cl: 0.601309850277438 , cd: 0.211086840529111},
  {cl: 0.568285475029486 , cd: 0.197653553200295},
  {cl: 0.510492818345571 , cd: 0.176255727765257},
  {cl: 0.483132714445128 , cd: 0.167062404747948},
  {cl: 0.461436881892194 , cd: 0.160200300064325},
  {cl: 0.418045216786326 , cd: 0.147611714122478},
  {cl: 0.385501467956925 , cd: 0.139163945163318},
  {cl: 0.342109802851057 , cd: 0.129225147214071},
  {cl: 0.298718137745189 , cd: 0.120800513832024},
  {cl: 0.249388066223454 , cd: 0.11306209742444},
  {cl: 0.207936707770252 , cd: 0.108072711176012},
  {cl: 0.15266822983265 , cd: 0.103569627182967},
  {cl: 0.0835826324106472 , cd: 0.101395214878043},
  {cl: 0.0144970349886442 , cd: 0.103059072224655}
]

const aurafiveaoas: number[] = [
  90, 85, 80, 75, 70, 65, 60, 55, 50, 45,
  44, 43, 42, 41, 40, 39, 38, 37, 36, 35,
  34, 33, 32, 31, 30, 28, 27, 26, 25, 24,
  23, 22, 21, 20, 19, 18, 17, 16, 15, 14,
  13, 12, 11, 10, 9, 8, 7, 6, 5, 4,
  3, 2, 1, 0
]

const aurafiveaoaindexes: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0.0973293002538006, 0.111603420554605, 0.126644343855929,
  0.142952948209109, 0.157392756917588, 0.176072473739675,
  0.192339895747025, 0.224200774751407, 0.241070606343121,
  0.255406594180041, 0.28703753161202, 0.313823164024654,
  0.354610522808676, 0.40272129228758, 0.469227952116029,
  0.538110242647231, 0.654985426264267, 0.846649581714156, 1
]

const aurafivecp: number[] = [
  0.901367256532332, 0.819922671799767, 0.81865591174113,
  0.817549210804472, 0.807584803437846, 0.7877449240893,
  0.759011807206887, 0.722367687238658, 0.678794798632662,
  0.629275375836952, 0.618744343806472, 0.608022597661911,
  0.597117995278852, 0.586038394532879, 0.574791653299577,
  0.563385629454531, 0.551828180873325, 0.540127165431543,
  0.52829044100477, 0.51632586546859, 0.504241296698587,
  0.492044592570347, 0.481452630223225, 0.475420516158898,
  0.469421112816359, 0.457459576274893, 0.451502244326367,
  0.445584032972467, 0.439735391686759, 0.433995116116988,
  0.428408751771098, 0.423026997703251, 0.417904110199851,
  0.413096306465556, 0.408660168309301, 0.40465104583032,
  0.40112146110416, 0.398119511868704, 0.395687275210186,
  0.393859211249218, 0.392660566826802, 0.39210577919035,
  0.392196879679709, 0.392921897413175, 0.394253262973511,
  0.396146212093973, 0.398537189344323, 0.401342251816851,
  0.404455472812395, 0.407747345526357, 0.411063186734725,
  0.414221540480093, 0.417012581757679, 0.419196520201342
]

export const aurafivepolar: WSEQPolar = {
  type: "Wingsuit",
  name: "Aura 5",
  public: true,
  polarslope: 0.402096647,
  polarclo: 0.078987854,
  polarmindrag: 0.101386726,
  rangemincl: 0.000679916,
  rangemaxcl: 0.950065434,
  aoaindexes: aurafiveaoaindexes,
  aoas: aurafiveaoas,
  cp: aurafivecp,
  stallpoint: aurafivestallpoint,
  s: 2,
  m: 77.5
}

// ─── Ibex UL Canopy ──────────────────────────────────────────────────────────

const ibexaoas: number[] = [
  90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35,
  30, 25, 20, 15, 10, 5, 0
]

const ibexaoaindexes: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0.0328, 0.090625, 0.1792, 0.306475, 0.4804, 0.708925, 1
]

const ibexcp: number[] = [
  0.05, 0.068, 0.068, 0.10400122, 0.140400122, 0.18,
  0.208196156, 0.239263709, 0.269097808, 0.298321118,
  0.327483484, 0.35314334, 0.37330676, 0.384385535,
  0.396690654, 0.400570261, 0.401, 0.401, 0.401
]

const ibex361coeffs: Coefficients[] = [
  { cl: 0, cd: 1 },
  { cl: 0.03, cd: 0.99 },
  { cl: 0.07, cd: 0.98 },
  { cl: 0.15, cd: 0.953 },
  { cl: 0.2, cd: 0.925 },
  { cl: 0.4, cd: 0.9 },
  { cl: 0.6, cd: 0.84 },
  { cl: 0.75, cd: 0.78 },
  { cl: 0.87, cd: 0.7 },
  { cl: 0.95, cd: 0.6 },
  { cl: 1, cd: 0.49 },
  { cl: 1.12006886897915, cd: 0.479960463043889 },
  { cl: 0.904260055464565, cd: 0.270848614164216 },
  { cl: 0.737065417620883, cd: 0.17123242286816 },
  { cl: 0.607025143742464, cd: 0.131412108918551 },
  { cl: 0.524831448174596, cd: 0.123239034936943 },
  { cl: 0.459344707642397, cd: 0.126149760622165 },
  { cl: 0.395071314200648, cd: 0.137132297109999 },
  { cl: 0.356507278135599, cd: 0.147585703712626 }
]

export const ibexulpolar: WSEQPolar = {
  type: "Canopy",
  name: "Ibex UL",
  public: true,
  polarslope: 1.6934221058100165,
  polarclo: 0.35823772469396875,
  polarmindrag: 0.19703077949220782,
  rangemincl: 0.27644921307405346,
  rangemaxcl: 0.975070024796286,
  aoaindexes: ibexaoaindexes,
  aoas: ibexaoas,
  cp: ibexcp,
  stallpoint: ibex361coeffs,
  s: 20.439,
  m: 77.5
}

// ─── Slick Sin (Full 360° skydiver) ─────────────────────────────────────────

const slicksinaoas: number[] = [
  180, 175, 170, 165, 160, 155, 150, 145, 140, 135,
  130, 125, 120, 115, 110, 105, 100, 95, 90, 85,
  80, 75, 70, 65, 60, 55, 50, 45, 40, 35,
  30, 25, 20, 15, 10, 5, 0,
  -5, -10, -15, -20, -25, -30, -35, -40, -45,
  -50, -55, -60, -65, -70, -75, -80, -85, -90,
  -95, -100, -105, -110, -115, -120, -125, -130, -135,
  -140, -145, -150, -155, -160, -165, -170, -175, -180
]

const slicksincp: number[] = [
  0.403, 0.393, 0.393, 0.395, 0.395, 0.395, 0.397, 0.397,
  0.3975, 0.4, 0.404, 0.405, 0.405, 0.4, 0.4, 0.4,
  0.396, 0.3951, 0.395, 0.3951, 0.396, 0.4, 0.405, 0.405,
  0.405, 0.404, 0.404, 0.4, 0.3975, 0.397, 0.395, 0.395,
  0.393, 0.393, 0.393, 0.403, 0.403,
  0.393, 0.393, 0.395, 0.395, 0.395, 0.397, 0.397,
  0.3975, 0.4, 0.404, 0.405, 0.405, 0.4, 0.4, 0.4,
  0.396, 0.3951, 0.395, 0.3951, 0.396, 0.4, 0.405, 0.405,
  0.405, 0.404, 0.404, 0.4, 0.3975, 0.397, 0.395, 0.395,
  0.393, 0.393, 0.393, 0.403, 0.403
]

const slicksinstallpoint: Coefficients[] = [
  { cl: 0, cd: 0.466661416322842 },
  { cl: -0.125342322477473, cd: 0.474546662056603 },
  { cl: -0.246876181912743, cd: 0.497962810056395 },
  { cl: -0.36090883348597, cd: 0.536198372514386 },
  { cl: -0.463975452782408, cd: 0.588091581213417 },
  { cl: -0.55294441272896, cd: 0.6520656872664 },
  { cl: -0.625112436498116, cd: 0.726176869833375 },
  { cl: -0.678286735206433, cd: 0.808173298134111 },
  { cl: -0.710851634695151, cd: 0.895563552186886 },
  { cl: -0.72181766697194, cd: 0.985692323343908 },
  { cl: -0.710851634695151, cd: 1.07582109450093 },
  { cl: -0.678286735206433, cd: 1.1632113485537 },
  { cl: -0.625112436498116, cd: 1.24520777685444 },
  { cl: -0.55294441272896, cd: 1.31931895942141 },
  { cl: -0.463975452782408, cd: 1.3832930654744 },
  { cl: -0.36090883348597, cd: 1.43518627417343 },
  { cl: -0.246876181912743, cd: 1.47342183663142 },
  { cl: -0.125342322477473, cd: 1.49683798463121 },
  { cl: 0, cd: 1.50472323036497 },
  { cl: 0.125342322477473, cd: 1.49683798463121 },
  { cl: 0.246876181912743, cd: 1.47342183663142 },
  { cl: 0.36090883348597, cd: 1.43518627417343 },
  { cl: 0.463975452782408, cd: 1.3832930654744 },
  { cl: 0.55294441272896, cd: 1.31931895942141 },
  { cl: 0.625112436498116, cd: 1.24520777685444 },
  { cl: 0.678286735206433, cd: 1.1632113485537 },
  { cl: 0.710851634695151, cd: 1.07582109450093 },
  { cl: 0.72181766697194, cd: 0.985692323343908 },
  { cl: 0.710851634695151, cd: 0.895563552186885 },
  { cl: 0.678286735206433, cd: 0.808173298134111 },
  { cl: 0.625112436498116, cd: 0.726176869833375 },
  { cl: 0.55294441272896, cd: 0.6520656872664 },
  { cl: 0.463975452782408, cd: 0.588091581213417 },
  { cl: 0.36090883348597, cd: 0.536198372514386 },
  { cl: 0.246876181912743, cd: 0.497962810056395 },
  { cl: 0.125342322477473, cd: 0.474546662056603 },
  { cl: 0, cd: 0.466661416322842 },
  { cl: -0.125342322477473, cd: 0.474546662056603 },
  { cl: -0.246876181912743, cd: 0.497962810056395 },
  { cl: -0.36090883348597, cd: 0.536198372514386 },
  { cl: -0.463975452782408, cd: 0.588091581213417 },
  { cl: -0.55294441272896, cd: 0.6520656872664 },
  { cl: -0.625112436498116, cd: 0.726176869833375 },
  { cl: -0.678286735206433, cd: 0.808173298134111 },
  { cl: -0.710851634695151, cd: 0.895563552186885 },
  { cl: -0.72181766697194, cd: 0.985692323343908 },
  { cl: -0.710851634695151, cd: 1.07582109450093 },
  { cl: -0.678286735206433, cd: 1.1632113485537 },
  { cl: -0.625112436498116, cd: 1.24520777685444 },
  { cl: -0.55294441272896, cd: 1.31931895942141 },
  { cl: -0.463975452782408, cd: 1.3832930654744 },
  { cl: -0.36090883348597, cd: 1.43518627417343 },
  { cl: -0.246876181912743, cd: 1.47342183663142 },
  { cl: -0.125342322477473, cd: 1.49683798463121 },
  { cl: 0, cd: 1.50472323036497 },
  { cl: 0.125342322477473, cd: 1.49683798463121 },
  { cl: 0.246876181912743, cd: 1.47342183663142 },
  { cl: 0.36090883348597, cd: 1.43518627417343 },
  { cl: 0.463975452782408, cd: 1.3832930654744 },
  { cl: 0.55294441272896, cd: 1.31931895942141 },
  { cl: 0.625112436498116, cd: 1.24520777685444 },
  { cl: 0.678286735206433, cd: 1.1632113485537 },
  { cl: 0.710851634695151, cd: 1.07582109450093 },
  { cl: 0.72181766697194, cd: 0.985692323343908 },
  { cl: 0.710851634695151, cd: 0.895563552186886 },
  { cl: 0.678286735206433, cd: 0.808173298134111 },
  { cl: 0.625112436498116, cd: 0.726176869833375 },
  { cl: 0.55294441272896, cd: 0.6520656872664 },
  { cl: 0.463975452782408, cd: 0.588091581213417 },
  { cl: 0.36090883348597, cd: 0.536198372514386 },
  { cl: 0.246876181912743, cd: 0.497962810056395 },
  { cl: 0.125342322477473, cd: 0.474546662056603 },
  { cl: 0, cd: 0.466661416322842 }
]

const slicksinaoaindexes: number[] = [
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, 0,
  0.00110666390772831, 0.00451870714716121, 0.0105095641391427,
  0.0195275224287945, 0.0321897909314248, 0.0492831790191334,
  0.0717777672819191, 0.10085949963318, 0.137986666884966,
  0.184972941986842, 0.244091712181965, 0.318168836871283,
  0.410540168081197, 0.52446808023432, 0.66081492664257,
  0.8111231335412, 0.943756264947077, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1
]

export const slicksinpolar: WSEQPolar = {
  type: "Slick",
  name: "slicksinangles",
  public: true,
  polarslope: 0.7,
  polarclo: 0,
  polarmindrag: 0.08,
  rangemincl: 0.0597,
  rangemaxcl: 0.128,
  s: 0.5,
  m: 77.5,
  clstallsep: 0.0597,
  cdstallsep: 0.0823,
  clstall: 0.128,
  cdstall: 0.16,
  stallmaxdrag: 0.266,
  aoaindexes: slicksinaoaindexes,
  aoas: slicksinaoas,
  cp: slicksincp,
  stallpoint: slicksinstallpoint
}

// ─── Caravan (Airplane) ──────────────────────────────────────────────────────

const caravanstallpoint: Coefficients[] = [
  { cl: 0.5165430339613966, cd: 0.07239915450672128 },
  { cl: 0.5029615742827824, cd: 0.06856977008347245 },
  { cl: 0.48909280298470004, cd: 0.06484394502252835 },
  { cl: 0.4750908507796766, cd: 0.061271536767406556 },
  { cl: 0.4610754308424907, cd: 0.057886066498164815 },
  { cl: 0.4471333352248565, cd: 0.05470728148458934 },
  { cl: 0.4333274133435328, cd: 0.0517452695322978 },
  { cl: 0.41969806839500734, cd: 0.049002425136722746 },
  { cl: 0.4062692430142357, cd: 0.04647609581822054 },
  { cl: 0.3930484192746416, cd: 0.04415971164565156 },
  { cl: 0.38003709359090987, cd: 0.04204550705082559 },
  { cl: 0.36722179823087775, cd: 0.04012361672672921 },
  { cl: 0.3545845762183286, cd: 0.03838437149203297 },
  { cl: 0.3421014849183067, cd: 0.03681836636083074 },
  { cl: 0.32973511396369376, cd: 0.035415985741904646 },
  { cl: 0.3264993358665586, cd: 0.03507351540292367 },
  { cl: 0.320631060334466, cd: 0.0344783263126852 },
  { cl: 0.3131757453331217, cd: 0.03377032919142504 },
  { cl: 0.3045275799315623, cd: 0.033016570298433676 },
  { cl: 0.29490936664706946, cd: 0.032263440513521396 },
  { cl: 0.2844667840486348, cd: 0.03154732238772506 },
  { cl: 0.2732820976811008, cd: 0.0308975866998465 },
  { cl: 0.26138787098930094, cd: 0.030339716736794725 },
  { cl: 0.2487755346456475, cd: 0.029898014037618752 },
  { cl: 0.2353911018863376, cd: 0.02959796306706299 },
  { cl: 0.2211283130492831, cd: 0.029469395833047238 }
]

const caravanaoas: number[] = [
  22.36810391019099, 21.567190131214463, 20.729470861641637, 19.860973542790497,
  18.967725615979003, 18.05575452252515, 17.1310877037469, 16.19975260096224,
  15.26777665548914, 14.341187308645575, 13.426012001749525, 12.528278176118965,
  11.654013273071874, 10.80924473392623, 10.0, 9.785974631870534,
  9.467852456626332, 9.057880157457355, 8.56830441755358, 8.01137192010497,
  7.399329348301502, 6.744423385333139, 6.0589007143898534, 5.3550080186616125,
  4.6449919813383875, 3.9410992856101466
]

const caravanaoaindexes: number[] = [
  0.0, 0.02584602497910915, 0.053301270010354784, 0.08218863382357977,
  0.11236860646815716, 0.1437442946215568, 0.1762504260046479, 0.20985801470475363,
  0.24456823497549784, 0.2804204781487116, 0.317471640678638, 0.3558278038437417,
  0.39562264208757336, 0.4370284024706963, 0.4802914063472369, 0.4920061469263761,
  0.5136918185308401, 0.5420960052078937, 0.5763116866183347, 0.6160756702196375,
  0.6614521303382338, 0.7128304814119495, 0.7709396415189791, 0.8369059462954722,
  0.912418437241464, 1.0
]

const caravancp: number[] = [
  0.4335454619403396, 0.4284531235418372, 0.4236779013904263, 0.4188763601209258,
  0.4143865383474914, 0.4102030860729039, 0.40628949904819345, 0.4028445250043731,
  0.3998956488561748, 0.3973856426552619, 0.3953531619560726, 0.3938154127962302,
  0.3927671705523868, 0.39217975945246836, 0.392, 0.39207465760524074,
  0.3922971560793683, 0.39265308013347633, 0.3931222361454322, 0.3936827701332322,
  0.39431233556641687, 0.39498855347245937, 0.3956891653622101, 0.39639032113568795,
  0.39707193465821666, 0.39771407549294413
]

export const caravanpolar: WSEQPolar = {
  type: 'Airplane',
  name: 'Caravan',
  public: true,
  polarslope: 0.484813091400691,
  polarclo: 0.21896316379267053,
  polarmindrag: 0.029467123091668542,
  rangemincl: 0.21741522340551012,
  rangemaxcl: 0.5258731795206912,
  aoaindexes: caravanaoaindexes,
  aoas: caravanaoas,
  cp: caravancp,
  stallpoint: caravanstallpoint,
  s: 2,
  m: 77.5
}

// ─── Mass Distributions ──────────────────────────────────────────────────────

/**
 * 14-point wingsuit body mass model.
 *
 * Positions are height-normalized (multiply by pilot height in meters).
 * Mass ratios are fractions of total system weight.
 * Origin is approximately at CG in NED body frame:
 *   x = forward (head), y = right, z = down
 *
 * Body extends from x_norm = -0.530 (feet) to +0.302 (head), span = 0.832.
 * Arms spread in flying position.
 */
const WINGSUIT_MASS_SEGMENTS: MassSegment[] = [
  { name: 'head',            massRatio: 0.14,   normalizedPosition: { x:  0.302049, y:  0,         z: -0.01759 } },
  { name: 'torso',           massRatio: 0.435,  normalizedPosition: { x:  0.078431, y:  0,         z:  0       } },
  { name: 'right_upper_arm', massRatio: 0.0275, normalizedPosition: { x:  0.174411, y:  0.158291,  z:  0       } },
  { name: 'right_forearm',   massRatio: 0.016,  normalizedPosition: { x:  0.141245, y:  0.247236,  z:  0       } },
  { name: 'right_hand',      massRatio: 0.008,  normalizedPosition: { x:  0.090994, y:  0.351759,  z:  0       } },
  { name: 'right_thigh',     massRatio: 0.1,    normalizedPosition: { x: -0.197951, y:  0.080402,  z:  0       } },
  { name: 'right_shin',      massRatio: 0.0465, normalizedPosition: { x: -0.397951, y:  0.145729,  z:  0       } },
  { name: 'right_foot',      massRatio: 0.0145, normalizedPosition: { x: -0.530112, y:  0.201005,  z: -0.00503 } },
  { name: 'left_upper_arm',  massRatio: 0.0275, normalizedPosition: { x:  0.174411, y: -0.158291,  z:  0       } },
  { name: 'left_forearm',    massRatio: 0.016,  normalizedPosition: { x:  0.141245, y: -0.247236,  z:  0       } },
  { name: 'left_hand',       massRatio: 0.008,  normalizedPosition: { x:  0.090994, y: -0.351759,  z:  0       } },
  { name: 'left_thigh',      massRatio: 0.1,    normalizedPosition: { x: -0.197951, y: -0.080402,  z:  0       } },
  { name: 'left_shin',       massRatio: 0.0465, normalizedPosition: { x: -0.397951, y: -0.145729,  z:  0       } },
  { name: 'left_foot',       massRatio: 0.0145, normalizedPosition: { x: -0.530112, y: -0.201005,  z: -0.00503 } },
]

/**
 * Canopy + pilot system mass model.
 *
 * Same 14 body segments as wingsuit, but rotated 90° for canopy flight:
 * the pilot hangs vertically below the canopy, so the head-to-toe axis
 * runs along z (NED down) instead of x (NED forward).
 *
 * System CG is near the riser attachment point, just above the pilot's head.
 * Pilot body hangs below (positive z), canopy sits above (negative z).
 *
 * Pilot segments are rotated 6° forward (trim angle) about the y-axis
 * relative to the riser attachment point — the canopy flies at a trim angle
 * so the pilot pendulums forward of the vertical line through the risers.
 *   x_trim = x·cos(6°) + z·sin(6°)
 *   z_trim = -x·sin(6°) + z·cos(6°)
 *
 * Additional masses: canopy structure (~3.5 kg) and canopy air (~27 kg).
 * Mass ratios are fractions of polar.m; ratios sum > 1.0 to include canopy mass.
 */
const TRIM_ANGLE_RAD = 6 * Math.PI / 180
const COS_TRIM = Math.cos(TRIM_ANGLE_RAD)
const SIN_TRIM = Math.sin(TRIM_ANGLE_RAD)

// Pre-trim pilot positions (after 90° rotation into canopy frame).
// x = forward offset from riser attachment. Each segment includes body depth
// (torso/limb CG sits forward of the spine line due to chest/thigh mass).
// A uniform forward shift of +0.16 is applied so the mass distribution
// aligns with the pilot model's center of volume.
const PILOT_FWD_SHIFT = 0.28
const PILOT_DOWN_SHIFT = 0.163   // 0.11 base + 0.053 visual alignment (~10 cm lower)
const CANOPY_PILOT_RAW: Array<{ name: string, massRatio: number, x: number, y: number, z: number }> = [
  { name: 'head',            massRatio: 0.14,   x:  0.10 + PILOT_FWD_SHIFT,  y:  0,      z:  0.280 + PILOT_DOWN_SHIFT },
  { name: 'torso',           massRatio: 0.435,  x:  0.10 + PILOT_FWD_SHIFT,  y:  0,      z:  0.480 + PILOT_DOWN_SHIFT },
  // Arms in flying position: upper arms raised alongside head, elbows bent ~90°,
  // forearms angled forward toward risers, hands near riser attachment (toggles).
  { name: 'right_upper_arm', massRatio: 0.0275, x:  0.08 + PILOT_FWD_SHIFT,  y:  0.090,  z:  0.300 + PILOT_DOWN_SHIFT },
  { name: 'right_forearm',   massRatio: 0.016,  x:  0.14 + PILOT_FWD_SHIFT,  y:  0.080,  z:  0.220 + PILOT_DOWN_SHIFT },
  { name: 'right_hand',      massRatio: 0.008,  x:  0.18 + PILOT_FWD_SHIFT,  y:  0.070,  z:  0.160 + PILOT_DOWN_SHIFT },
  { name: 'right_thigh',     massRatio: 0.1,    x:  0.10 + PILOT_FWD_SHIFT,  y:  0.060,  z:  0.720 + PILOT_DOWN_SHIFT },
  { name: 'right_shin',      massRatio: 0.0465, x:  0.08 + PILOT_FWD_SHIFT,  y:  0.050,  z:  0.900 + PILOT_DOWN_SHIFT },
  { name: 'right_foot',      massRatio: 0.0145, x:  0.06 + PILOT_FWD_SHIFT,  y:  0.050,  z:  1.010 + PILOT_DOWN_SHIFT },
  { name: 'left_upper_arm',  massRatio: 0.0275, x:  0.08 + PILOT_FWD_SHIFT,  y: -0.090,  z:  0.300 + PILOT_DOWN_SHIFT },
  { name: 'left_forearm',    massRatio: 0.016,  x:  0.14 + PILOT_FWD_SHIFT,  y: -0.080,  z:  0.220 + PILOT_DOWN_SHIFT },
  { name: 'left_hand',       massRatio: 0.008,  x:  0.18 + PILOT_FWD_SHIFT,  y: -0.070,  z:  0.160 + PILOT_DOWN_SHIFT },
  { name: 'left_thigh',      massRatio: 0.1,    x:  0.10 + PILOT_FWD_SHIFT,  y: -0.060,  z:  0.720 + PILOT_DOWN_SHIFT },
  { name: 'left_shin',       massRatio: 0.0465, x:  0.08 + PILOT_FWD_SHIFT,  y: -0.050,  z:  0.900 + PILOT_DOWN_SHIFT },
  { name: 'left_foot',       massRatio: 0.0145, x:  0.06 + PILOT_FWD_SHIFT,  y: -0.050,  z:  1.010 + PILOT_DOWN_SHIFT },
]

// Riser attachment point in NED body frame (post-trim rotation).
// This is the pivot the pilot swings around when pitching fore/aft.
export const PILOT_PIVOT_X = +(PILOT_FWD_SHIFT * COS_TRIM + PILOT_DOWN_SHIFT * SIN_TRIM).toFixed(4)
export const PILOT_PIVOT_Z = +(-PILOT_FWD_SHIFT * SIN_TRIM + PILOT_DOWN_SHIFT * COS_TRIM).toFixed(4)

// Pilot body segments rotated by trim angle (shared between weight and inertia)
export const CANOPY_PILOT_SEGMENTS: MassSegment[] = CANOPY_PILOT_RAW.map(p => ({
  name: p.name,
  massRatio: p.massRatio,
  normalizedPosition: {
    x: +(p.x * COS_TRIM + p.z * SIN_TRIM).toFixed(4),
    y: p.y,
    z: +(-p.x * SIN_TRIM + p.z * COS_TRIM).toFixed(4),
  }
}))

// 7 canopy cells across span, forming an arc over the pilot's head.
// Each cell has structure mass and trapped air mass.
// Total structure: ~3.5 kg (0.045 of 77.5 kg), split 1/7 each → 0.00643
// Total air: ~6 kg (0.077 of 77.5 kg), split 1/7 each → 0.011
//
// Arc geometry: cells at equal angular spacing (12° apart) on radius R=1.55
//   Cell positions: y = R·sin(θ), z = z_center + R·(1 - cos(θ))
//   θ = 0°, ±12°, ±24°, ±36°
//   Center z = -1.10 (lowest point of arc)
//   Then rotated 6° forward about y-axis to sit in canopy's thickest section
//
// CANOPY_Z_SHIFT: visual alignment nudge — 20 cm higher (~-0.107 normalised)
// to better match the 3D model's canopy position.

const CANOPY_STRUCTURE_SEGMENTS: MassSegment[] = [
  { name: 'canopy_structure_c',  massRatio: 0.00643, normalizedPosition: { x: 0.165, y:  0,     z: -1.196 } },
  { name: 'canopy_structure_r1', massRatio: 0.00643, normalizedPosition: { x: 0.161, y:  0.322, z: -1.162 } },
  { name: 'canopy_structure_l1', massRatio: 0.00643, normalizedPosition: { x: 0.161, y: -0.322, z: -1.162 } },
  { name: 'canopy_structure_r2', massRatio: 0.00643, normalizedPosition: { x: 0.151, y:  0.630, z: -1.062 } },
  { name: 'canopy_structure_l2', massRatio: 0.00643, normalizedPosition: { x: 0.151, y: -0.630, z: -1.062 } },
  { name: 'canopy_structure_r3', massRatio: 0.00643, normalizedPosition: { x: 0.134, y:  0.911, z: -0.901 } },
  { name: 'canopy_structure_l3', massRatio: 0.00643, normalizedPosition: { x: 0.134, y: -0.911, z: -0.901 } },
]

const CANOPY_AIR_SEGMENTS: MassSegment[] = [
  { name: 'canopy_air_c',  massRatio: 0.011, normalizedPosition: { x: 0.165, y:  0,     z: -1.196 } },
  { name: 'canopy_air_r1', massRatio: 0.011, normalizedPosition: { x: 0.161, y:  0.322, z: -1.162 } },
  { name: 'canopy_air_l1', massRatio: 0.011, normalizedPosition: { x: 0.161, y: -0.322, z: -1.162 } },
  { name: 'canopy_air_r2', massRatio: 0.011, normalizedPosition: { x: 0.151, y:  0.630, z: -1.062 } },
  { name: 'canopy_air_l2', massRatio: 0.011, normalizedPosition: { x: 0.151, y: -0.630, z: -1.062 } },
  { name: 'canopy_air_r3', massRatio: 0.011, normalizedPosition: { x: 0.134, y:  0.911, z: -0.901 } },
  { name: 'canopy_air_l3', massRatio: 0.011, normalizedPosition: { x: 0.134, y: -0.911, z: -0.901 } },
]

/**
 * Weight segments — contribute to gravitational force (m·g).
 * Includes pilot body + canopy structure. Excludes trapped air (buoyant).
 */
const CANOPY_WEIGHT_SEGMENTS: MassSegment[] = [
  ...CANOPY_PILOT_SEGMENTS,
  ...CANOPY_STRUCTURE_SEGMENTS,
]

/**
 * Inertia segments — contribute to rotational inertia (I·α).
 * Includes everything: pilot body + canopy structure + trapped air.
 * Air mass is buoyant so it doesn't add weight, but it does resist rotation.
 */
const CANOPY_INERTIA_SEGMENTS: MassSegment[] = [
  ...CANOPY_PILOT_SEGMENTS,
  ...CANOPY_STRUCTURE_SEGMENTS,
  ...CANOPY_AIR_SEGMENTS,
]

/**
 * Rotate pilot body mass segments by a pitch increment, swinging about the
 * riser attachment point (shoulder pivot), then combine with fixed canopy masses.
 *
 * The base CANOPY_PILOT_SEGMENTS already include the 6° trim rotation.
 * This function applies an additional rotation on top, representing the
 * pilot swinging fore/aft under the canopy.
 *
 * @param pilotPitch_deg  Incremental pilot pitch [deg]. Positive = aft (feet forward).
 * @param pivot  Optional NED pivot point for rotation (from 3D model alignment).
 * @param deploy  Deployment fraction 0–1. Scales canopy segment span positions.
 * @returns `{ weight, inertia }` — complete mass segment arrays for CG and inertia.
 */
export function rotatePilotMass(
  pilotPitch_deg: number,
  pivot?: { x: number; z: number },
  deploy: number = 1,
): { weight: MassSegment[], inertia: MassSegment[] } {
  const noPitch = Math.abs(pilotPitch_deg) < 0.01
  const fullDeploy = Math.abs(deploy - 1) < 0.001

  if (noPitch && fullDeploy) {
    // No rotation, full deploy — return the pre-computed arrays
    return { weight: CANOPY_WEIGHT_SEGMENTS, inertia: CANOPY_INERTIA_SEGMENTS }
  }

  const delta = pilotPitch_deg * Math.PI / 180
  const cos_d = Math.cos(delta)
  const sin_d = Math.sin(delta)

  // Use the provided pivot (from 3D model alignment) or fall back to
  // the analytically-computed riser attachment point.
  const pivotX = pivot?.x ?? PILOT_PIVOT_X
  const pivotZ = pivot?.z ?? PILOT_PIVOT_Z

  // Pilot segments: rotate about pivot (only when pitch != 0)
  let rotatedPilot: MassSegment[]
  if (noPitch) {
    rotatedPilot = CANOPY_PILOT_SEGMENTS
  } else {
    const delta = pilotPitch_deg * Math.PI / 180
    const cos_d = Math.cos(delta)
    const sin_d = Math.sin(delta)
    rotatedPilot = CANOPY_PILOT_SEGMENTS.map(seg => {
      const dx = seg.normalizedPosition.x - pivotX
      const dz = seg.normalizedPosition.z - pivotZ
      return {
        name: seg.name,
        massRatio: seg.massRatio,
        normalizedPosition: {
          x: dx * cos_d - dz * sin_d + pivotX,
          y: seg.normalizedPosition.y,
          z: dx * sin_d + dz * cos_d + pivotZ,
        }
      }
    })
  }

  // Canopy segments: scale span (y) and shift x forward by deploy offset
  const spanScale = 0.1 + 0.9 * deploy
  const chordOffset = DEPLOY_CHORD_OFFSET * (1 - deploy)  // lerp to zero at full deploy
  const scaleCanopyDeploy = (segs: MassSegment[]): MassSegment[] =>
    fullDeploy ? segs : segs.map(seg => ({
      ...seg,
      normalizedPosition: {
        ...seg.normalizedPosition,
        x: seg.normalizedPosition.x + chordOffset,
        y: seg.normalizedPosition.y * spanScale,
      }
    }))

  const deployedStructure = scaleCanopyDeploy(CANOPY_STRUCTURE_SEGMENTS)
  const deployedAir = scaleCanopyDeploy(CANOPY_AIR_SEGMENTS)

  return {
    weight: [...rotatedPilot, ...deployedStructure],
    inertia: [...rotatedPilot, ...deployedStructure, ...deployedAir],
  }
}

// ─── Canopy Aero Segments ────────────────────────────────────────────────────

/**
 * Per-cell base polar for canopy airfoil.
 *
 * This is the ContinuousPolar for a single cell panel — NOT the lumped system.
 * Key differences from the lumped ibexulContinuous:
 * - S = total canopy area / 7 ≈ 2.92 m² (per cell)
 * - cd_0 = canopy-only profile drag (~0.035), not system drag (0.21)
 *   System parasitic drag is handled by separate line/pilot/bridle segments.
 * - chord = canopy cell chord (~2.5 m), not body reference length (8 m)
 *
 * All stall, lift-curve, moment, and CP parameters start from the lumped
 * polar values. These are initial estimates — tuning via debug overrides
 * will refine them per-segment.
 */
const CANOPY_CELL_POLAR: ContinuousPolar = {
  name: 'Ibex UL Cell',
  type: 'Canopy',

  // Lift model — same airfoil profile across all cells
  cl_alpha: 3.0,
  alpha_0: -3,

  // Drag model — cell-only, parasitic bodies handle the rest
  cd_0: 0.035,
  k: 0.04,

  // Separated flow — same as lumped
  cd_n: 1.1,
  cd_n_lateral: 0.8,

  // Stall — raised base stall to give headroom when brakes reduce it
  alpha_stall_fwd: 22,
  s1_fwd: 6,
  alpha_stall_back: -5,
  s1_back: 3,

  // Side force & moments
  cy_beta: -0.4,
  cn_beta: 0.12,
  cl_beta: -0.12,

  // Pitching moment
  cm_0: -0.03,
  cm_alpha: -0.10,

  // Center of pressure
  cp_0: 0.40,
  cp_alpha: -0.01,

  // CG / CP lateral (per-cell, not system-level)
  cg: 0.35,
  cp_lateral: 0.50,

  // Physical — per cell
  s: 20.439 / 7,   // ≈ 2.92 m²
  m: 77.5,          // system mass (for weight calculation — only used at system level)
  chord: 2.5,       // cell chord [m]

  // Brake control derivatives (per-cell — same as lumped, applied via δ)
  controls: {
    brake: {
      d_alpha_0: -5,
      d_cd_0: 0.09,
      d_cl_alpha: 0.35,
      d_k: 0.03,
      d_alpha_stall_fwd: -4,
      cm_delta: -0.04,
    }
  }
}

/**
 * Brake flap polar — for the deflected trailing-edge portion of each cell.
 *
 * When brakes are applied, the trailing edge of the canopy deflects downward
 * like a plain flap. This polar models that deflected fabric panel as a
 * separate lifting surface.
 *
 * Key characteristics:
 * - High CD_n (fabric plate, not a clean airfoil) → ~1.2
 * - Moderate CL_α (~4.0 /rad — thin fabric, not ideal airfoil)
 * - Higher CD_0 than the main cell (~0.08 — partially separated fabric edge)
 * - No controls (deflection modeled via α offset in the factory)
 *
 * The flap area and chord scale with brake input (variable-area model):
 * at brake=0 the flap contributes nothing; at brake=1 the flap is fully deployed.
 */
const BRAKE_FLAP_POLAR: ContinuousPolar = {
  name: 'Brake Flap',
  type: 'Canopy',

  // Lift model — fabric trailing edge, lower efficiency than main airfoil
  cl_alpha: 4.0,        // ~thin flat plate theory, fabric efficiency loss
  alpha_0: 0,           // flap neutral when aligned with local flow

  // Drag model — clean fabric at low deflection, low parasitic drag
  cd_0: 0.02,
  k: 0.05,              // flap in parent cell's flowfield — efficient lift production

  // Separated flow — fabric plate, high normal force
  cd_n: 1.2,
  cd_n_lateral: 0.8,

  // Stall — fabric flap stays attached over the full deflection range.
  // At full brake (50° deflection + ~12° α_local = 62°), the flap must
  // still be in attached flow to produce the lift needed for landing flare.
  // Real fabric trailing edges don't hard-stall like rigid airfoils.
  alpha_stall_fwd: 70,
  s1_fwd: 8,
  alpha_stall_back: -5,
  s1_back: 3,

  // Side force & moments — minimal contribution from flap
  cy_beta: -0.1,
  cn_beta: 0.02,
  cl_beta: -0.02,

  // Pitching moment — flap at TE creates nose-down moment
  cm_0: -0.05,
  cm_alpha: -0.05,

  // Center of pressure — aft on the deflected panel
  cp_0: 0.60,
  cp_alpha: -0.01,

  // CG / CP lateral
  cg: 0.35,
  cp_lateral: 0.50,

  // Physical — base values, overridden per-flap by the factory
  s: 0.5,               // placeholder, factory sets actual area
  m: 77.5,
  chord: 0.5,           // placeholder, factory sets actual chord
}

/**
 * 16 aerodynamic segments for the Ibex UL canopy system.
 *
 * 7 canopy cells (using arc geometry from mass segments) +
 * 6 brake flap segments (trailing edge of non-center cells) +
 * 2 parasitic bodies (lines + pilot chute) +
 * 1 pilot (added by makeIbexAeroSegments).
 *
 * Cell positions match the mass segment positions exactly.
 * Brake sensitivity cascades from tips inward: outer=1.0, mid=0.7, inner=0.4, center=0.
 * Flap chord fractions graduate: outer=30%, mid=20%, inner=10%.
 * Riser sensitivity is ~1.0 for all cells (uniform geometry change).
 */
const IBEX_CANOPY_SEGMENTS: AeroSegment[] = [
  // ── 7 canopy cells ──
  // Positions extended outward along arc radius to sit on the upper canopy skin.
  // Graduated push: center ~4.5 cm, inner ~9 cm, mid ~15 cm, outer ~22 cm extra
  // because the real canopy is flatter than a perfect arc at the wingtips.
  makeCanopyCellSegment('cell_c',  { x: 0.174, y:  0,     z: -1.220 },   0, 'center', 0,   1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_r1', { x: 0.170, y:  0.358, z: -1.182 },  12, 'right',  0.4, 1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_l1', { x: 0.170, y: -0.358, z: -1.182 }, -12, 'left',   0.4, 1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_r2', { x: 0.162, y:  0.735, z: -1.114 },  24, 'right',  0.7, 1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_l2', { x: 0.162, y: -0.735, z: -1.114 }, -24, 'left',   0.7, 1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_r3', { x: 0.145, y:  1.052, z: -0.954 },  36, 'right',  1.0, 1.0, CANOPY_CELL_POLAR),
  makeCanopyCellSegment('cell_l3', { x: 0.145, y: -1.052, z: -0.954 }, -36, 'left',   1.0, 1.0, CANOPY_CELL_POLAR),

  // ── 6 brake flap segments (trailing edge of non-center cells) ──
  // Variable-area flap model: S and chord scale with brake input.
  // Graduated chord fraction: inner=10%, mid=20%, outer=30%.
  // Positions at the trailing edge of each cell (aft = lower x in NED).
  // TE offset from cell AC ≈ 0.75 × chord / height ≈ 1.0 normalized.
  // z values use the inner arc surface (structure positions), not the pushed-out
  // cell skin positions, because the canopy profile tapers to zero at the TE.
  // As brake is applied, position shifts forward toward cell center (quarter-chord of deployed flap).
  //                         name        TE position (NED norm)                       θ     side     brkSens chordFrac  cellS         cellChord  polar
  makeBrakeFlapSegment('flap_r1', { x: -0.664, y:  0.358, z: -1.162 },  12, 'right',  0.4,  0.10,  20.439/7, 2.5,  0.170, BRAKE_FLAP_POLAR),
  makeBrakeFlapSegment('flap_l1', { x: -0.664, y: -0.358, z: -1.162 }, -12, 'left',   0.4,  0.10,  20.439/7, 2.5,  0.170, BRAKE_FLAP_POLAR),
  makeBrakeFlapSegment('flap_r2', { x: -0.672, y:  0.735, z: -1.062 },  24, 'right',  0.7,  0.20,  20.439/7, 2.5,  0.162, BRAKE_FLAP_POLAR),
  makeBrakeFlapSegment('flap_l2', { x: -0.672, y: -0.735, z: -1.062 }, -24, 'left',   0.7,  0.20,  20.439/7, 2.5,  0.162, BRAKE_FLAP_POLAR),
  makeBrakeFlapSegment('flap_r3', { x: -0.689, y:  1.052, z: -0.901 },  36, 'right',  1.0,  0.30,  20.439/7, 2.5,  0.145, BRAKE_FLAP_POLAR),
  makeBrakeFlapSegment('flap_l3', { x: -0.689, y: -1.052, z: -0.901 }, -36, 'left',   1.0,  0.30,  20.439/7, 2.5,  0.145, BRAKE_FLAP_POLAR),

  // ── 2 parasitic bodies (lines + pilot chute — always the same) ──
  //                    name       position (NED norm)                   S      chord  CD
  makeParasiticSegment('lines',  { x: 0.23, y: 0, z: -0.40 },          0.35,  0.01,  1.0       ),
  makeParasiticSegment('pc',     { x: 0.10, y: 0, z: -1.30 },          0.732, 0.01,  1.0       ),
]

/** Pilot position in NED normalized coordinates (below+behind canopy). */
const PILOT_POSITION = { x: 0.38, y: 0, z: 0.48 }

/**
 * Build the complete Ibex UL aero segments array for a given pilot type.
 *
 * Canopy cells + parasitic bodies are always the same.
 * The pilot segment changes based on pilot type:
 * - 'wingsuit': Full Kirchhoff lifting body using Aura 5 polar (S=2m², proper CL/CD/CY)
 * - 'slick':    Full Kirchhoff lifting body using Slick Sin polar (S=0.5m², high drag)
 *
 * The pilot is hanging vertically under the canopy — rotated 90° in pitch
 * relative to the prone wingsuit pose. This pitch offset is applied so the
 * polar is evaluated at the correct local α (freestream α − 90°).
 */
export function makeIbexAeroSegments(pilotType: 'wingsuit' | 'slick' = 'wingsuit'): AeroSegment[] {
  // Pilot polar must be defined before this is called (it references the
  // aurafive/slicksin objects declared later). This works because JS
  // module-level const declarations are initialized before any function
  // call at runtime.
  //
  // pitchOffset = 90°: pilot is upright (hanging), not prone (flying).
  // This rotates the freestream α by −90° before evaluating the polar,
  // and shifts the CP offset direction from NED x to NED z.
  const PILOT_PITCH_OFFSET = 90
  const pilotSegment = pilotType === 'wingsuit'
    ? makeUnzippablePilotSegment('pilot', PILOT_POSITION, aurafiveContinuous, slicksinContinuous, PILOT_PITCH_OFFSET)
    : makeLiftingBodySegment('pilot', PILOT_POSITION, slicksinContinuous, PILOT_PITCH_OFFSET)

  return [...IBEX_CANOPY_SEGMENTS, pilotSegment]
}

// Default segments are built after all polars are defined (see bottom of file)
// to avoid TDZ issues with forward references to aurafiveContinuous/slicksinContinuous.

// ─── Continuous Polar Definitions ────────────────────────────────────────────

/**
 * Aura 5 wingsuit continuous polar.
 * 
 * Parameters derived from the legacy Aura 5 polar data:
 * - CL_α estimated from the near-linear region (~5°–18°): CL goes from ~0.15 to ~0.81
 *   over ~13° ≈ 0.227 rad → CL_α ≈ 2.9 /rad
 * - α_0 ≈ 0° (CL ≈ 0.015 at α=0°, nearly zero)
 * - CD_0 ≈ 0.101 (minimum drag near α=0°)
 * - K ≈ 0.40 (from polarslope)
 * - Forward stall ~25° (CL peaks around 25-28°)
 * - Back stall ~-5° (limited back-flying data)
 * - CD_n ≈ 1.1 (broadside drag at 90° is ~1.09)
 */
export const aurafiveContinuous: ContinuousPolar = {
  name: 'Aura 5',
  type: 'Wingsuit',

  cl_alpha: 2.9,
  alpha_0: -2,

  cd_0: 0.097,
  k: 0.360,

  cd_n: 1.1,
  cd_n_lateral: 1.0,

  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,

  alpha_stall_back: -34.5,
  s1_back: 7,

  cy_beta: -0.3,
  cn_beta: 0.08,
  cl_beta: -0.08,

  cm_0: -0.02,
  cm_alpha: -0.08,

  cp_0: 0.40,
  cp_alpha: -0.05,

  cg: 0.40,
  cp_lateral: 0.50,

  s: 2,
  m: 77.5,
  chord: 1.8,

  massSegments: WINGSUIT_MASS_SEGMENTS,
  cgOffsetFraction: 0.137,

  controls: {
    brake: {
      d_cp_0:             0.03,   // CP shifts aft 3% chord at full arch (δ=+1)
      d_alpha_0:         -0.5,    // 0.5° camber increase at full arch
      d_cd_0:             0.005,  // Very small drag increase at full arch
      d_alpha_stall_fwd: -1.0,    // Stall angle decreases 1° at full arch
    },
    dirty: {
      d_cd_0:             0.025,  // Significant parasitic drag increase (loose suit)
      d_cl_alpha:        -0.3,    // Less efficient lift generation
      d_k:                0.08,   // More induced drag (worse span efficiency)
      d_alpha_stall_fwd: -3.0,    // Stalls 3° earlier (less tension = earlier separation)
      d_cp_0:             0.03,   // CP moves toward CG (0.40 → 0.43, CG=0.40)
      d_cp_alpha:         0.02,   // CP travel reduced (stays closer to CG)
    }
  }
}

/**
 * Ibex UL canopy continuous polar.
 * 
 * Parameters fitted to the legacy Ibex UL polar data:
 * - CL_α ≈ 1.75 /rad (lower than classic wing — parafoil lift curve is gentle,
 *   rising gradually from CL≈0.36 at 0° to peak CL≈1.12 at 35°)
 * - α_0 ≈ -12° (RAM-air parafoil has substantial camber; produces
 *   significant lift even at 0° AOA: CL(0°)=1.75·sin(12°)≈0.36)
 * - CD_0 ≈ 0.11 (canopy parasitic drag)
 * - K ≈ 0.065 (low induced drag factor — large span, moderate CL range)
 * - Forward stall ~40° (CL peak in legacy data at 35°; sigmoid catches it)
 * - Back stall ~-5° (limited back-flying data)
 * - CD_n ≈ 1.1 (collapsed canopy broadside)
 * - CP ≈ 0.40 nearly constant across normal flight range
 */
export const ibexulContinuous: ContinuousPolar = {
  name: 'Ibex UL',
  type: 'Canopy',

  cl_alpha: 1.75,
  alpha_0: -3,

  cd_0: 0.21,
  k: 0.085,

  cd_n: 1.1,
  cd_n_lateral: 0.8,

  alpha_stall_fwd: 15,
  s1_fwd: 4,

  alpha_stall_back: -5,
  s1_back: 3,

  cy_beta: -0.4,
  cn_beta: 0.12,
  cl_beta: -0.12,

  cm_0: -0.03,
  cm_alpha: -0.10,

  cp_0: 0.40,
  cp_alpha: -0.01,

  cg: 0.35,
  cp_lateral: 0.50,

  s: 20.439,
  m: 77.5,
  chord: 2.5,

  massSegments: CANOPY_WEIGHT_SEGMENTS,
  inertiaMassSegments: CANOPY_INERTIA_SEGMENTS,
  cgOffsetFraction: 0,

  aeroSegments: undefined as unknown as AeroSegment[],  // set below after polars defined

  controls: {
    brake: {
      d_alpha_0: -3,            // Full brakes shift α_0 down 3° (more camber)
      d_cd_0: 0.06,             // Full brakes add ~0.06 parasitic drag
      d_cl_alpha: 0.15,         // Slight increase in lift slope from camber
      d_k: 0.03,                // Small increase in induced drag factor
      d_alpha_stall_fwd: -5,    // Full brakes lower stall angle by 5°
      cm_delta: -0.04,          // Brakes add nose-down pitching moment
    }
  }
}

/**
 * Slick skydiver continuous polar.
 * 
 * The slick sin data already covers the full 360° using sin/cos functions.
 * Parameters:
 * - CL_α ≈ 1.45 /rad (body is not an efficient lifting surface)
 * - α_0 ≈ 0° (symmetric body)
 * - CD_0 ≈ 0.467 (high parasitic — human body)
 * - K ≈ 0.70 (high induced drag)
 * - CD_n ≈ 1.5 (broadside body drag at 90°)
 * - Nearly symmetric stall behavior
 */
export const slicksinContinuous: ContinuousPolar = {
  name: 'Slick Sin',
  type: 'Slick',

  cl_alpha: 1.45,
  alpha_0: 0,

  cd_0: 0.467,
  k: 0.70,

  cd_n: 1.505,
  cd_n_lateral: 1.3,

  alpha_stall_fwd: 45,
  s1_fwd: 8,

  alpha_stall_back: -45,
  s1_back: 8,

  cy_beta: -0.2,
  cn_beta: 0.04,
  cl_beta: -0.04,

  cm_0: 0,
  cm_alpha: -0.05,

  cp_0: 0.40,
  cp_alpha: -0.01,

  cg: 0.50,
  cp_lateral: 0.50,

  s: 0.5,
  m: 77.5,
  chord: 1.7
}

/**
 * Caravan airplane continuous polar.
 * 
 * Parameters derived from the legacy Caravan polar data:
 * - CL_α ≈ 4.8 /rad (efficient wing, CL range ~0.22–0.52 over ~18° ≈ 0.31 rad)
 * - α_0 ≈ -2° (positive CL at α=0°, typical cambered airfoil)
 * - CD_0 ≈ 0.029 (very low parasitic drag — clean airplane)
 * - K ≈ 0.485 (from polarslope)
 * - Forward stall ~22° (CL peaks around 22°)
 * - Back stall ~-4°
 * - CD_n ≈ 1.2 (broadside fuselage + wing drag)
 */
export const caravanContinuous: ContinuousPolar = {
  name: 'Caravan',
  type: 'Airplane',

  cl_alpha: 4.8,
  alpha_0: -2,

  cd_0: 0.029,
  k: 0.485,

  cd_n: 1.2,
  cd_n_lateral: 1.0,

  alpha_stall_fwd: 22,
  s1_fwd: 4,

  alpha_stall_back: -4,
  s1_back: 3,

  cy_beta: -0.4,
  cn_beta: 0.10,
  cl_beta: -0.10,

  cm_0: -0.02,
  cm_alpha: -0.10,

  cp_0: 0.39,
  cp_alpha: -0.04,

  cg: 0.30,
  cp_lateral: 0.30,

  s: 2,
  m: 77.5,
  chord: 11.0
}

// ─── A5 Segments — 6-Segment Wingsuit ────────────────────────────────────────

/**
 * Segment position system — chord-fraction based.
 *
 * The 3D model is centered at the CG (center of gravity), which is at (0,0,0)
 * in Three.js / NED. All positions are measured FROM the CG.
 *
 * To place a point on the chord at fraction x/c:
 *   position_x = (cg_xc - target_xc) × chord / height
 *
 * Examples (cg_xc = 0.40, chord = 1.8m, height = 1.875m):
 *   x/c = 0.00 (LE/head):  (0.40 − 0.00) × 0.96 = +0.384  (forward of CG)
 *   x/c = 0.25 (QC):       (0.40 − 0.25) × 0.96 = +0.144  (forward of CG)
 *   x/c = 0.40 (CG):       (0.40 − 0.40) × 0.96 =  0.000  (at origin)
 *   x/c = 0.70 (aft):      (0.40 − 0.70) × 0.96 = −0.288  (behind CG)
 *
 * Span (y) positions still use GLB_TO_NED scaling from the 3D model.
 */
const A5_SYS_CHORD = 1.8     // system chord [m]
const A5_CG_XC    = 0.40     // CG location as chord fraction (x/c)
const A5_HEIGHT   = 1.875    // pilot height [m] (normalization divisor)
const GLB_TO_NED  = 0.2962   // GLB → NED scale for span (y-axis) positions

/** Convert a system-chord fraction to NED normalized x-position. */
function a5xc(xc: number): number {
  return (A5_CG_XC - xc) * A5_SYS_CHORD / A5_HEIGHT
}

/**
 * Per-segment x/c positions (aerodynamic center = quarter-chord of each panel).
 *
 * Derived by matching arrow positions to the GLB model panel meshes.
 * Model bbox (raw GLB): center.z = −0.698, size.z = 3.550.
 * Conversion: NED_x = GLB_z × (s / bodyLength) + model_pos_z / bodyLength
 *           = GLB_z × 0.2817 + 0.0597
 * Then x/c  = A5_CG_XC − NED_x × height / chord
 *
 * Panel QC positions (GLB z of mesh + 0.25 × GLB chord toward LE):
 *   head:       GLB z = +0.88  → NED +0.308 → x/c ≈ 0.13
 *   center QC:  GLB z = −0.25  → NED −0.011 → x/c ≈ 0.46
 *   inner QC:   GLB z = −0.354 → NED −0.040 → x/c ≈ 0.49
 *   outer QC:   GLB z = +0.076 → NED +0.081 → x/c ≈ 0.37
 */

/** Head — parasitic bluff body (sphere), rudder in sideslip. */
const A5_HEAD_S = 0.07          // ~25 cm diameter sphere equivalent
const A5_HEAD_CHORD = 0.13     // head dimension
const A5_HEAD_CD = 0.42         // helmeted head, streamlined sphere
const A5_HEAD_POS = {           // x/c = 0.13
  x: a5xc(0.13),               //  +0.307 (forward of CG)
  y: 0,
  z: 0,
}

/** Center body — fuselage + tail wing, primary lifting surface. */
const A5_CENTER_POLAR: ContinuousPolar = {
  name: 'A5 Center',
  type: 'Wingsuit',
  cl_alpha: 3.2,              // slightly higher than system (2.9) — wings dilute avg
  alpha_0: -2,
  cd_0: 0.08,                // torso frontal area (tuned for L/D ≈ 2.87)
  k: 0.35,                   // shorter AR than full span
  cd_n: 1.2,                 // torso broadside
  cd_n_lateral: 1.0,
  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,
  alpha_stall_back: -34.5,
  s1_back: 7,
  cy_beta: -0.3,
  cn_beta: 0.08,
  cl_beta: -0.04,            // body only — less dihedral effect than system
  cm_0: -0.02,
  cm_alpha: -0.10,
  cp_0: 0.25,                // quarter-chord (segment LE reference, not head)
  cp_alpha: -0.05,
  cg: 0.40,
  cp_lateral: 0.50,
  s: 0.85,                   // 42.5% of 2.0 m²
  m: 77.5,
  chord: 1.93,               // GLB 3.0 × k × 1.875
  controls: {
    dirty: {
      d_cd_0: 0.015,
      d_cl_alpha: -0.15,
      d_alpha_stall_fwd: -2,
    }
  }
}
const A5_CENTER_POS = {       // x/c = 0.46 (center panel QC, slightly aft of CG)
  x: a5xc(0.46),             // −0.010 (just behind CG)
  y: 0,
  z: 0,
}

/** Inner wing — shoulder→knee fabric panels, tapered trailing edge.
 *
 * Shape: The center body segment flares out at the hips, creating a notch in
 * the inner wing's trailing edge. This means:
 *   - Less surface area in the aft portion → effective AC/CP shifts forward
 *   - The panel chord extends full length, but the wing tapers to very little
 *     area near the trailing edge (below the knee it barely contributes)
 *
 * Twist / outboard deflection: The pilot's leg joins the chord near the
 * trailing edge, creating a cambered section with ~30° of effective twist
 * (0° at LE, 30° at TE). This deflects airflow outboard (left wing pushes
 * air left, right wing pushes air right).
 *
 * This outboard deflection behind the CG is the primary source of
 * weathervane (directional) stability: in sideslip, the cambered aft panels
 * generate a side force that, through the lever arm behind CG, creates a
 * restoring yaw moment (strong positive cn_beta).
 */
const A5_INNER_WING_POLAR: ContinuousPolar = {
  name: 'A5 Inner Wing',
  type: 'Wingsuit',
  cl_alpha: 2.8,              // reduced — tapered TE has less effective lifting area
  alpha_0: -1,
  cd_0: 0.05,                // fabric drag (tuned for L/D ≈ 2.87)
  k: 0.30,                   // better span efficiency than body
  cd_n: 1.0,                 // fabric broadside
  cd_n_lateral: 0.8,
  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,
  alpha_stall_back: -34.5,
  s1_back: 7,
  cy_beta: -0.35,             // strong side force from outboard-deflecting camber at TE
  cn_beta: 0.12,              // primary weathervane source: TE camber behind CG
  cl_beta: -0.08,            // dihedral effect
  cm_0: 0,
  cm_alpha: -0.05,
  cp_0: 0.23,                // slightly forward of QC — tapered TE means less aft area
  cp_alpha: -0.03,
  cg: 0.40,
  cp_lateral: 0.50,
  s: 0.39,                   // 19.5% of 2.0 m² (each side)
  m: 77.5,
  chord: 1.74,               // GLB 2.7 × k × 1.875
  controls: {
    dirty: {
      d_cd_0: 0.03,
      d_cl_alpha: -0.4,
      d_alpha_stall_fwd: -4,
    }
  }
}
const A5_R1_POS = {           // x/c = 0.48 (slightly forward of geometric QC due to tapered TE)
  x: a5xc(0.48),             //  −0.077 (slightly behind CG)
  y: 0.72 * GLB_TO_NED,      //  0.213 (span)
  z: 0,
}
const A5_L1_POS = {           // mirror
  x: a5xc(0.48),
  y: -0.72 * GLB_TO_NED,
  z: 0,
}

/** Outer wing — hand area only, small wingtip control surfaces. */
const A5_OUTER_WING_POLAR: ContinuousPolar = {
  name: 'A5 Outer Wing',
  type: 'Wingsuit',
  cl_alpha: 2.6,              // lower AR, tip losses
  alpha_0: -1,
  cd_0: 0.07,                // exposed edge — slightly higher
  k: 0.35,
  cd_n: 1.0,
  cd_n_lateral: 0.8,
  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,
  alpha_stall_back: -34.5,
  s1_back: 7,
  cy_beta: -0.15,
  cn_beta: 0.02,
  cl_beta: -0.10,            // strong dihedral effect (far outboard)
  cm_0: 0,
  cm_alpha: -0.05,
  cp_0: 0.25,                // quarter-chord (segment LE reference)
  cp_alpha: -0.03,
  cg: 0.40,
  cp_lateral: 0.50,
  s: 0.15,                   // 7.5% of 2.0 m² (each side)
  m: 77.5,
  chord: 0.39,               // GLB 0.6 × k × 1.875
  controls: {
    dirty: {
      d_cd_0: 0.04,
      d_cl_alpha: -0.5,
      d_alpha_stall_fwd: -5,
    }
  }
}
const A5_R2_POS = {           // x/c = 0.37 (outer wing panel QC)
  x: a5xc(0.37),             //  +0.077 (forward of CG)
  y: 1.10 * GLB_TO_NED,      //  0.326 (span)
  z: 0,
}
const A5_L2_POS = {           // mirror
  x: a5xc(0.37),
  y: -1.10 * GLB_TO_NED,
  z: 0,
}

/**
 * Build the 6 aero segments for the A5 Segments wingsuit.
 *
 * Segments:
 *   1. head    — parasitic sphere (rudder in sideslip)
 *   2. center  — fuselage + tail wing (primary lift)
 *   3. r1      — right inner wing (shoulder→elbow + hip→feet)
 *   4. l1      — left inner wing (mirror)
 *   5. r2      — right outer wing (hand/wingtip)
 *   6. l2      — left outer wing (mirror)
 *
 * Each segment responds to pitchThrottle, yawThrottle, rollThrottle,
 * dihedral, and dirty via the makeWingsuitLiftingSegment / makeWingsuitHeadSegment
 * factory closures.
 */
export function makeA5SegmentsAeroSegments(): AeroSegment[] {
  return [
    // Head — parasitic bluff body, responds to yawThrottle (lateral shift)
    makeWingsuitHeadSegment('head', A5_HEAD_POS, A5_HEAD_S, A5_HEAD_CHORD, A5_HEAD_CD),

    // Center body — primary lift, responds to pitchThrottle + yawThrottle (body shift)
    makeWingsuitLiftingSegment('center', A5_CENTER_POS, 0, 'center', A5_CENTER_POLAR, 0.3, 'body'),

    // Inner wings — respond to all throttles + dihedral
    //   rollSensitivity = 0.6 (constrained by body)
    makeWingsuitLiftingSegment('r1', A5_R1_POS, 0, 'right', A5_INNER_WING_POLAR, 0.6, 'inner'),
    makeWingsuitLiftingSegment('l1', A5_L1_POS, 0, 'left',  A5_INNER_WING_POLAR, 0.6, 'inner'),

    // Outer wings (wingtips) — highest roll authority, strongest dihedral
    //   rollSensitivity = 1.0 (hands/wrists have most freedom)
    makeWingsuitLiftingSegment('r2', A5_R2_POS, 0, 'right', A5_OUTER_WING_POLAR, 1.0, 'outer'),
    makeWingsuitLiftingSegment('l2', A5_L2_POS, 0, 'left',  A5_OUTER_WING_POLAR, 1.0, 'outer'),
  ]
}

/**
 * A5 Segments — 6-segment wingsuit continuous polar.
 *
 * System-level ContinuousPolar that matches aurafiveContinuous at symmetric
 * conditions. The segment model (aeroSegments) distributes forces across
 * the 6 segments for asymmetric flight, turning, and throttle control.
 *
 * Uses the same base parameters as aurafiveContinuous. The new capability
 * is entirely in the per-segment aero model, not the system-level polar.
 */
export const a5segmentsContinuous: ContinuousPolar = {
  name: 'A5 Segments',
  type: 'Wingsuit',

  cl_alpha: 2.9,
  alpha_0: -2,

  cd_0: 0.097,
  k: 0.360,

  cd_n: 1.1,
  cd_n_lateral: 1.0,

  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,

  alpha_stall_back: -34.5,
  s1_back: 7,

  cy_beta: -0.3,
  cn_beta: 0.08,
  cl_beta: -0.08,

  cm_0: -0.02,
  cm_alpha: -0.08,

  cp_0: 0.40,
  cp_alpha: -0.05,

  cg: 0.40,
  cp_lateral: 0.50,

  s: 2,
  m: 77.5,
  chord: 1.8,

  massSegments: WINGSUIT_MASS_SEGMENTS,
  cgOffsetFraction: 0.137,

  controls: {
    brake: {
      d_cp_0:             0.03,
      d_alpha_0:         -0.5,
      d_cd_0:             0.005,
      d_alpha_stall_fwd: -1.0,
    },
    dirty: {
      d_cd_0:             0.025,
      d_cl_alpha:        -0.3,
      d_k:                0.08,
      d_alpha_stall_fwd: -3.0,
      d_cp_0:             0.03,
      d_cp_alpha:         0.02,
    }
  }
}

// ─── Initialize aeroSegments (after all polars are defined) ──────────────────

// Set default aero segments for Ibex UL (wingsuit pilot).
// This must happen after aurafiveContinuous is defined since the pilot
// segment delegates to it for coefficient evaluation.
ibexulContinuous.aeroSegments = makeIbexAeroSegments('wingsuit')

// Set default aero segments for A5 Segments wingsuit.
a5segmentsContinuous.aeroSegments = makeA5SegmentsAeroSegments()

// ─── Registry ────────────────────────────────────────────────────────────────

export const continuousPolars: Record<string, ContinuousPolar> = {
  aurafive: aurafiveContinuous,
  a5segments: a5segmentsContinuous,
  ibexul: ibexulContinuous,
  slicksin: slicksinContinuous,
  caravan: caravanContinuous
}

export const legacyPolars: Record<string, WSEQPolar> = {
  aurafive: aurafivepolar,
  a5segments: aurafivepolar,
  ibexul: ibexulpolar,
  slicksin: slicksinpolar,
  caravan: caravanpolar
}
