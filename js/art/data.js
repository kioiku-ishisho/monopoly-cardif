/*
 * 3D 美術模組：職業資料
 * cos：角色服裝色（大眾認知的職業服裝色）
 * pal：地圖主題配色（使用者的配色檔，見 handoff 的 palettes.prefixed.css）
 * key 與 js/data.js 的 jobs[].id 相同
 */
(function () {
  'use strict';
  const A = window.RealLifeArt;
  if (!A) return;

  A.PRO = {
    doctor: { name: '醫生', en: 'Doctor',
      cos: ['#f4f7fa', '#4fa3c7', '#a9d9ec', '#3b4048', '#cfd6dd'],
      pal: ['#b9d6f2', '#061a40', '#0353a4', '#006daa', '#003559'] },
    engineer: { name: '工程師', en: 'Engineer',
      cos: ['#3d424d', '#17181c', '#39d353', '#2a2a2e', '#c5cad3'],
      pal: ['#442b48', '#726e60', '#98b06f', '#b6dc76', '#dbff76'] },
    nurse: { name: '護理師', en: 'Nurse',
      cos: ['#f7b7c9', '#ffffff', '#e5383b', '#fdfdfd', '#2f6fd1'],
      pal: ['#cad2c5', '#84a98c', '#52796f', '#354f52', '#2f3e46'] },
    teacher: { name: '小學老師', en: 'Teacher',
      cos: ['#d98e4a', '#ffffff', '#6b4a32', '#2a2a2e', '#d62f2f', '#b98b5e'],
      pal: ['#f2c57c', '#ddae7e', '#7fb685', '#426a5a', '#ef6f6c'] },
    civil: { name: '公務員', en: 'Civil servant',
      cos: ['#f4f4f1', '#1f3a5f', '#25221f', '#3b6ea8', '#ffffff'],
      pal: ['#1f271b', '#0b4f6c', '#145c9e', '#cbb9a8', '#dddddd'] },
    sales: { name: '業務專員', en: 'Sales',
      cos: ['#1f2d4d', '#ffffff', '#c62828', '#1c1c1f', '#2b2b30'],
      pal: ['#000000', '#14213d', '#fca311', '#e5e5e5', '#ffffff'] },
    designer: { name: '平面設計師', en: 'Designer',
      cos: ['#26262b', '#c8342f', '#f7cb15', '#4aa3df', '#e8453c'],
      pal: ['#f55d3e', '#878e88', '#f7cb15', '#ffffff', '#76bed0'] },
    chef: { name: '廚師', en: 'Chef',
      cos: ['#f7f8fa', '#d62f2f', '#2b2b30', '#c9ced6', '#dfe3ea'],
      pal: ['#de1a1a', '#e8ebf7', '#26bb5f', '#f2d398', '#d78521'] },
    courier: { name: '外送員', en: 'Courier',
      cos: ['#1fb26a', '#26262b', '#d9dde3', '#f5f5f5', '#111114'],
      pal: ['#000000', '#3d2645', '#832161', '#da4167', '#f0eff4'] },
    farmer: { name: '農夫', en: 'Farmer',
      cos: ['#e7c76a', '#f3ead2', '#3f6fa6', '#c0392b', '#b98b5e', '#8c9399'],
      pal: ['#ffba59', '#73a9cc', '#678d58', '#a6c48a', '#dfdfdf'] },
  };
  A.ORDER = ['doctor', 'engineer', 'nurse', 'teacher', 'civil', 'sales', 'designer', 'chef', 'courier', 'farmer'];
})();
