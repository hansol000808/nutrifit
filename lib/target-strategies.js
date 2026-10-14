(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NutriFitTargets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Each strategy implements calculate({ weight, tdee }) and returns the same
  // policy shape. Shared validation and nutritional limits belong to the caller
  // and calculator, so a goal policy can be replaced independently.
  class MaintainStrategy {
    calculate({ weight, tdee }) {
      return { calories: tdee, protein: weight * 1.6, fatRatio: 0.25 };
    }
  }

  class DietStrategy {
    calculate({ weight, tdee }) {
      return { calories: tdee - 500, protein: weight * 1.8, fatRatio: 0.25 };
    }
  }

  class BulkUpStrategy {
    calculate({ weight, tdee }) {
      return { calories: tdee + 400, protein: weight * 2, fatRatio: 0.2 };
    }
  }

  class CalorieCalculator {
    constructor(strategy) {
      this.setStrategy(strategy);
    }

    setStrategy(strategy) {
      if (!strategy || typeof strategy.calculate !== 'function') {
        throw new TypeError('목표 전략에는 calculate 메서드가 필요합니다.');
      }
      this.strategy = strategy;
    }

    // The core passes an already validated profile. This context has no goal
    // branches: the injected strategy owns the goal-specific calculation.
    calculate(profile) {
      const { gender, age, height, weight, activity } = profile;
      const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === 'male' ? 5 : -161);
      const policy = this.strategy.calculate({ weight, tdee: bmr * activity });
      if (!policy || !Number.isFinite(policy.calories) || !Number.isFinite(policy.protein)
        || policy.protein < 0 || !Number.isFinite(policy.fatRatio) || policy.fatRatio < 0 || policy.fatRatio > 1) {
        throw new TypeError('목표 전략이 올바른 계산 결과를 반환하지 않았습니다.');
      }
      const calories = Math.max(1200, Math.min(4500, policy.calories));
      const protein = policy.protein;
      const fat = calories * policy.fatRatio / 9;
      const carb = Math.max(0, (calories - protein * 4 - fat * 9) / 4);
      return { calories: Math.round(calories), carb: Math.round(carb), protein: Math.round(protein), fat: Math.round(fat) };
    }
  }

  // Only this composition point knows which policy belongs to each goal.
  const goalStrategies = Object.freeze({
    maintain: Object.freeze(new MaintainStrategy()),
    diet: Object.freeze(new DietStrategy()),
    bulk: Object.freeze(new BulkUpStrategy())
  });

  return { MaintainStrategy, DietStrategy, BulkUpStrategy, CalorieCalculator, goalStrategies };
});
