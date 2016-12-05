$(document).ready(function() {
    // convert difficulty level to corresponding visual effect
    var level = ['beginner', 'intermediate', 'advanced'];
    level.forEach(function(item, index) {
        $(".difficulty:contains(" + item +")").html(item + " " + "&#x25A0;".repeat(index) + "&#x25A1;".repeat(3 - index));
    });
    // convert recommend level to corresponding visual effect
    var recommend = [1, 2, 3, 4, 5];
    recommend.forEach(function(item) {
        $(".recommend:contains("+item+")").html("recommend " + "&#x2605;".repeat(item) + "&#x2606;".repeat(5 - item));        
    });

    
});