;; Field-v1 ripple simulation. Fixed 60 Hz damped 2-D wave on a 32x32 grid with
;; zero boundaries. Two signed height fields and a contiguous R8 display field.
(module
  (memory (export "memory") 1 1)
  (global $a (mut i32) (i32.const 2048))
  (global $b (mut i32) (i32.const 4096))
  (global $time (mut f32) (f32.const 0))
  (func (export "fieldPtr") (result i32) (i32.const 0))
  (func (export "reset")
    (memory.fill (i32.const 0) (i32.const 128) (i32.const 1024))
    (memory.fill (i32.const 2048) (i32.const 0) (i32.const 4096))
    (global.set $time (f32.const 0))
    ;; Off-centre displacement (x=6,y=6).
    (i32.store16 (i32.add (global.get $a) (i32.const 396)) (i32.const 4096))
    (i32.store8 (i32.const 198) (i32.const 255)))
  (func $tick (local $x i32) (local $y i32) (local $i i32)
              (local $p i32) (local $q i32) (local $h i32)
    (local.set $y (i32.const 1))
    (loop $row
      (local.set $x (i32.const 1))
      (loop $cell
        (local.set $i (i32.add (i32.mul (local.get $y) (i32.const 32)) (local.get $x)))
        (local.set $p (i32.add (global.get $a) (i32.shl (local.get $i) (i32.const 1))))
        (local.set $q (i32.add (global.get $b) (i32.shl (local.get $i) (i32.const 1))))
        (local.set $h (i32.sub
          (i32.shr_s (i32.add
            (i32.add (i32.load16_s (i32.sub (local.get $p) (i32.const 64)))
                     (i32.load16_s offset=64 (local.get $p)))
            (i32.add (i32.load16_s (i32.sub (local.get $p) (i32.const 2)))
                     (i32.load16_s offset=2 (local.get $p)))) (i32.const 1))
          (i32.load16_s (local.get $q))))
        (local.set $h (i32.div_s (i32.mul (local.get $h) (i32.const 31)) (i32.const 32)))
        (i32.store16 (local.get $q) (local.get $h))
        (local.set $h (i32.add (i32.const 128) (i32.shr_s (local.get $h) (i32.const 2))))
        (local.set $h (select (i32.const 255) (local.get $h) (i32.gt_s (local.get $h) (i32.const 255))))
        (i32.store8 (local.get $i) (select (i32.const 0) (local.get $h) (i32.lt_s (local.get $h) (i32.const 0))))
        (local.tee $x (i32.add (local.get $x) (i32.const 1)))
        (br_if $cell (i32.lt_u (i32.const 31))))
      (local.tee $y (i32.add (local.get $y) (i32.const 1)))
      (br_if $row (i32.lt_u (i32.const 31))))
    (local.set $p (global.get $a)) (global.set $a (global.get $b)) (global.set $b (local.get $p)))
  (func (export "step") (param $dt f32)
    (global.set $time (f32.add (global.get $time) (local.get $dt)))
    (block $end (loop $again
      (br_if $end (f32.lt (global.get $time) (f32.const 0.016666667)))
      (call $tick)
      (global.set $time (f32.sub (global.get $time) (f32.const 0.016666667)))
      (br $again)))))
