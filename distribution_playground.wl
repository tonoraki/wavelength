(* Wavelength 目标分布实时调节 —— 4 参数独立控制
   分段 Hermite 平滑 (C^1),保证 W 形:
     [0,U]  : 中心 M  -> 谷 V   (平滑step)
     [U,0.5]: 谷 V   -> 端 E   (平滑step)
   u = -0.5 <-> 中心位置 0 ; u = 0 <-> 中心 500 ; u = 0.5 <-> 中心 1000 *)

Manipulate[
 Module[{sm, p},
  sm[t_] = t^2 (3 - 2 t);
  p[uu_] := Piecewise[{
    {M + (V - M) sm[Abs[uu]/U], 0 <= Abs[uu] < U},
    {V + (E - V) sm[(Abs[uu] - U)/(0.5 - U)], U <= Abs[uu] <= 0.5}
  }];
  Column[{
    Style["当前参数   中心 M = " <> ToString[NumberForm[M, {6, 2}]] <>
      "    两端 E = " <> ToString[NumberForm[E, {6, 2}]] <>
      "    谷 V = " <> ToString[NumberForm[V, {6, 2}]] <>
      "    谷位置 U = " <> ToString[NumberForm[U, {6, 2}]],
     14, Bold, RGBColor[0.15, 0.35, 0.75]],
    Plot[p[u], {u, -0.5, 0.5},
     PlotRange -> {0, 3},
     PlotStyle -> {Thick, RGBColor[0.10, 0.45, 0.90]},
     GridLines -> {{-0.5, -U, 0, U, 0.5}, None},
     Frame -> True,
     FrameLabel -> {"x \[Element] [-0.5, 0.5]   (对应中心位置 0 ~ 1000)", "相对概率密度"},
     Epilog -> {
       {PointSize[0.022], Point[{{-0.5, E}, {-U, V}, {0, M}, {U, V}, {0.5, E}}]},
       Text[Style["两端 " <> ToString[Round[E, 0.01]], 12, Bold], {0.05, E + 0.20}],
       Text[Style["中心 " <> ToString[Round[M, 0.01]], 12, Bold], {0.05, M + 0.20}],
       Text[Style["谷 " <> ToString[Round[V, 0.01]] <> "  @ \[PlusMinus]" <> ToString[Round[U, 0.03]], 12],
        {0.05, V + 0.20}],
       Text[Style["最左 0", 10, Gray], {-0.5, -0.35}],
       Text[Style["中心 500", 10, Gray], {0, -0.35}],
       Text[Style["最右 1000", 10, Gray], {0.5, -0.35}]
      }]
  }]
 ],
 Row[{
   Button["均匀  {M1,E1,V1,U0.16}", (M = 1; E = 1; V = 1; U = 0.16)],
   Button["适中  {M0.9,E1.2,V0.65,U0.16}", (M = 0.9; E = 1.2; V = 0.65; U = 0.16)],
   Button["推荐  {M0.9,E1.5,V0.50,U0.16}", (M = 0.9; E = 1.5; V = 0.5; U = 0.16)],
   Button["明显  {M0.9,E1.8,V0.35,U0.16}", (M = 0.9; E = 1.8; V = 0.35; U = 0.16)]
 }],
 {{M, 0.9, "中心高度 M"}, 0.2, 2, 0.05},
 {{E, 1.5, "两端高度 E（最高点）"}, 0.2, 3, 0.05},
 {{V, 0.5, "谷高度 V"}, 0, 1.5, 0.05},
 {{U, 0.16, "谷位置 U（0~0.5）"}, 0.05, 0.45, 0.01},
 TrackedSymbols :> {M, E, V, U},
 ControlPlacement -> Left
]
